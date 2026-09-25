use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockStatus {
    pub has_employee: bool,
    pub employee_id: Option<String>,
    pub is_clocked_in: bool,
    pub active_work_period: Option<WorkPeriod>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkPeriod {
    pub id: String,
    pub start_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntry {
    pub id: String,
    pub employee_id: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub timestamp: String,
}

/// A committed write and a current-state read have independent outcomes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockWriteOutcome {
    /// Legacy transport entries; empty for a version 2 command receipt.
    pub entries: Vec<TimeEntry>,
    /// The frozen command's identity, when the write used version 2.
    pub operation_id: Option<String>,
    pub status: Option<ClockStatus>,
    pub status_refresh_failed: bool,
    pub context_changed: bool,
}

/// Legacy breaks are two independent requests. Even a failed first response
/// cannot prove absence of a commit. Preserve any acknowledged close separately.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakFailure {
    pub close_acknowledged: bool,
    pub close_entry: Option<TimeEntry>,
    pub resume_attempted: bool,
}

impl std::fmt::Display for BreakFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Break outcome requires review; close or resume may have committed"
        )
    }
}

impl std::error::Error for BreakFailure {}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkLocationType {
    Office,
    Home,
    Remote,
    Other,
}

impl WorkLocationType {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "office" => Some(Self::Office),
            "home" => Some(Self::Home),
            "remote" => Some(Self::Remote),
            "other" => Some(Self::Other),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Office => "office",
            Self::Home => "home",
            Self::Remote => "remote",
            Self::Other => "other",
        }
    }
}

pub struct ClockService {
    pub(crate) client: reqwest::Client,
}

fn clock_in_body(
    work_location_type: WorkLocationType,
    timestamp: Option<&str>,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "type": "clock_in",
        "workLocationType": work_location_type.as_str(),
    });

    if let Some(timestamp) = timestamp {
        body["timestamp"] = serde_json::Value::String(timestamp.to_string());
    }

    body
}

impl ClockService {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    pub async fn committed_with_status(
        &self,
        webapp_url: &str,
        token: &str,
        entries: Vec<TimeEntry>,
    ) -> ClockWriteOutcome {
        let status = self.get_status(webapp_url, token).await.ok();
        ClockWriteOutcome {
            operation_id: None,
            context_changed: false,
            status_refresh_failed: status.is_none(),
            entries,
            status,
        }
    }

    pub async fn clock_in_with_status(
        &self,
        webapp_url: &str,
        token: &str,
        work_location_type: WorkLocationType,
    ) -> Result<ClockWriteOutcome> {
        let entry = self
            .clock_in(webapp_url, token, work_location_type, None)
            .await?;
        Ok(self
            .committed_with_status(webapp_url, token, vec![entry])
            .await)
    }

    pub async fn clock_out_with_status(
        &self,
        webapp_url: &str,
        token: &str,
    ) -> Result<ClockWriteOutcome> {
        let entry = self.clock_out(webapp_url, token).await?;
        Ok(self
            .committed_with_status(webapp_url, token, vec![entry])
            .await)
    }

    pub async fn break_with_status(
        &self,
        webapp_url: &str,
        token: &str,
        break_start_time: DateTime<Utc>,
        work_location_type: WorkLocationType,
    ) -> Result<ClockWriteOutcome> {
        let entries = self
            .clock_out_with_break(
                webapp_url,
                token,
                break_start_time,
                work_location_type,
                None,
            )
            .await?;
        Ok(self.committed_with_status(webapp_url, token, entries).await)
    }

    /// Fetches current clock status from the webapp
    pub async fn get_status(&self, webapp_url: &str, token: &str) -> Result<ClockStatus> {
        let url = format!(
            "{}/api/time-entries/status",
            webapp_url.trim_end_matches('/')
        );

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow::anyhow!(
                "Failed to fetch clock status: {}",
                response.status()
            ));
        }

        let status: ClockStatus = response.json().await?;
        Ok(status)
    }

    /// Clocks in the user
    pub async fn clock_in(
        &self,
        webapp_url: &str,
        token: &str,
        work_location_type: WorkLocationType,
        timestamp: Option<&str>,
    ) -> Result<TimeEntry> {
        let url = format!("{}/api/time-entries", webapp_url.trim_end_matches('/'));

        let body = clock_in_body(work_location_type, timestamp);

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Clock in failed: {}", error_text));
        }

        let result: serde_json::Value = response.json().await?;
        let entry = serde_json::from_value(result["entry"].clone())?;
        Ok(entry)
    }

    /// Clocks out the user
    pub async fn clock_out(&self, webapp_url: &str, token: &str) -> Result<TimeEntry> {
        let url = format!("{}/api/time-entries", webapp_url.trim_end_matches('/'));

        let body = serde_json::json!({
            "type": "clock_out",
        });

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Clock out failed: {}", error_text));
        }

        let result: serde_json::Value = response.json().await?;
        let entry = serde_json::from_value(result["entry"].clone())?;
        Ok(entry)
    }

    /// Clocks out at a specific time (for break handling) then clocks back in
    pub async fn clock_out_with_break(
        &self,
        webapp_url: &str,
        token: &str,
        break_start_time: DateTime<Utc>,
        work_location_type: WorkLocationType,
        resume_timestamp: Option<&str>,
    ) -> Result<Vec<TimeEntry>> {
        let url = format!("{}/api/time-entries", webapp_url.trim_end_matches('/'));

        // First, clock out at the break start time
        let clock_out_body = serde_json::json!({
            "type": "clock_out",
            "timestamp": break_start_time.to_rfc3339(),
        });

        let mut failure = BreakFailure {
            close_acknowledged: false,
            close_entry: None,
            resume_attempted: false,
        };
        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "application/json")
            .json(&clock_out_body)
            .send()
            .await
            .map_err(|_| failure.clone())?;

        if !response.status().is_success() {
            return Err(failure.into());
        }
        failure.close_acknowledged = true;
        let body: serde_json::Value = response.json().await.map_err(|_| failure.clone())?;
        let close_entry: TimeEntry =
            serde_json::from_value(body["entry"].clone()).map_err(|_| failure.clone())?;
        failure.close_entry = Some(close_entry.clone());
        failure.resume_attempted = true;
        let resume_entry = self
            .clock_in(webapp_url, token, work_location_type, resume_timestamp)
            .await
            .map_err(|_| failure)?;
        Ok(vec![close_entry, resume_entry])
    }
}

#[cfg(test)]
mod tests {
    use super::{clock_in_body, WorkLocationType};

    #[test]
    fn work_location_type_accepts_only_supported_values() {
        assert_eq!(
            WorkLocationType::from_str("office").map(WorkLocationType::as_str),
            Some("office")
        );
        assert_eq!(
            WorkLocationType::from_str("home").map(WorkLocationType::as_str),
            Some("home")
        );
        assert_eq!(
            WorkLocationType::from_str("remote").map(WorkLocationType::as_str),
            Some("remote")
        );
        assert_eq!(
            WorkLocationType::from_str("other").map(WorkLocationType::as_str),
            Some("other")
        );
        assert!(WorkLocationType::from_str("invalid").is_none());
    }

    #[test]
    fn clock_in_body_includes_timestamp_only_when_provided() {
        assert_eq!(
            clock_in_body(WorkLocationType::Remote, None),
            serde_json::json!({
                "type": "clock_in",
                "workLocationType": "remote",
            })
        );

        assert_eq!(
            clock_in_body(WorkLocationType::Remote, Some("2026-05-01T00:00:00+00:00")),
            serde_json::json!({
                "type": "clock_in",
                "workLocationType": "remote",
                "timestamp": "2026-05-01T00:00:00+00:00",
            })
        );
    }
}
