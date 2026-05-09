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
    client: reqwest::Client,
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

    /// Fetches current clock status from the webapp
    pub async fn get_status(&self, webapp_url: &str, token: &str) -> Result<ClockStatus> {
        let url = format!("{}/api/time-entries/status", webapp_url.trim_end_matches('/'));

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
    ) -> Result<()> {
        let url = format!("{}/api/time-entries", webapp_url.trim_end_matches('/'));

        // First, clock out at the break start time
        let clock_out_body = serde_json::json!({
            "type": "clock_out",
            "timestamp": break_start_time.to_rfc3339(),
        });

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "application/json")
            .json(&clock_out_body)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Clock out for break failed: {}", error_text));
        }

        // Then, clock back in at current time unless replaying a queued resume.
        let clock_in_body = clock_in_body(work_location_type, resume_timestamp);

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "application/json")
            .json(&clock_in_body)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Clock in after break failed: {}",
                error_text
            ));
        }

        Ok(())
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
