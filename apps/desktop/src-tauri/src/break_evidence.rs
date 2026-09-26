//! Device evidence for a confirmed idle break (#281, resolution #263 §8).
//!
//! The break the employee confirms runs from the last input before idleness
//! (an estimate of when they stopped) to the first input after it (the detected
//! return), never to the later dialog answer. Every observation pairs the UTC
//! wall clock with a monotonic reading, so a wall-clock change while idle is
//! visible. The zone of each endpoint is the one observed then: the start zone
//! is read when idleness is detected, the return zone at the return.
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::sync::OnceLock;
use std::time::Instant;

/// One device observation: the UTC wall clock (millisecond precision, as it is
/// sent) and a process-relative monotonic reading taken together.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Observation {
    pub utc: DateTime<Utc>,
    pub monotonic_ms: u64,
}

impl Observation {
    pub fn now() -> Self {
        static EPOCH: OnceLock<Instant> = OnceLock::new();
        let monotonic_ms = EPOCH.get_or_init(Instant::now).elapsed().as_millis() as u64;
        let utc = Utc::now();
        Self {
            utc: DateTime::from_timestamp_millis(utc.timestamp_millis()).unwrap_or(utc),
            monotonic_ms,
        }
    }
}

/// An observation together with the device IANA zone read at that moment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZonedObservation {
    pub at: Observation,
    /// None when the zone could not be read.
    pub timezone: Option<String>,
}

/// An idle span that ended with the employee's return.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdleBreak {
    /// Local identity the confirmation refers to; never a server identity.
    pub id: String,
    pub last_activity: Observation,
    pub idle_detected: ZonedObservation,
    pub returned: ZonedObservation,
}

/// A confirmed break: the idle span plus when the employee confirmed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BreakEvidence {
    pub idle: IdleBreak,
    pub confirmed: Observation,
}

/// Why a break cannot be recorded automatically and needs a reviewed correction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BreakReview {
    /// The wall clock and the monotonic clock disagree, so the interval is uncertain.
    ClockDiscontinuity,
    /// The device zone could not be read when idleness was detected.
    StartZoneUnavailable,
    /// The device zone could not be read at the return.
    ReturnZoneUnavailable,
}

/// Allowed disagreement between elapsed wall and monotonic time: two seconds
/// plus one millisecond per monotonic second. The server applies the same rule.
pub const CLOCK_TOLERANCE_BASE_MS: i64 = 2_000;
pub const CLOCK_TOLERANCE_PER_SECOND_MS: i64 = 1;

/// Whether consecutive observations agree on elapsed time.
pub fn clocks_agree(observations: &[Observation]) -> bool {
    observations.windows(2).all(|pair| {
        let monotonic = pair[1].monotonic_ms as i64 - pair[0].monotonic_ms as i64;
        let wall = (pair[1].utc - pair[0].utc).num_milliseconds();
        let allowed =
            CLOCK_TOLERANCE_BASE_MS + monotonic.div_euclid(1000) * CLOCK_TOLERANCE_PER_SECOND_MS;
        monotonic >= 0 && (wall - monotonic).abs() <= allowed
    })
}

impl IdleBreak {
    /// Why the observed span cannot become an automatic break, if anything.
    pub fn review(&self) -> Option<BreakReview> {
        if !clocks_agree(&[self.last_activity, self.idle_detected.at, self.returned.at]) {
            return Some(BreakReview::ClockDiscontinuity);
        }
        if self.idle_detected.timezone.is_none() {
            return Some(BreakReview::StartZoneUnavailable);
        }
        if self.returned.timezone.is_none() {
            return Some(BreakReview::ReturnZoneUnavailable);
        }
        None
    }

    pub fn idle_ms(&self) -> u64 {
        self.returned
            .at
            .monotonic_ms
            .saturating_sub(self.last_activity.monotonic_ms)
    }
}

impl BreakEvidence {
    /// Whether the interval is trustworthy through the confirmation too.
    pub fn clocks_agree(&self) -> bool {
        clocks_agree(&[
            self.idle.last_activity,
            self.idle.idle_detected.at,
            self.idle.returned.at,
            self.confirmed,
        ])
    }

    pub fn review(&self) -> Option<BreakReview> {
        if !self.clocks_agree() {
            return Some(BreakReview::ClockDiscontinuity);
        }
        self.idle.review()
    }
}

#[derive(Debug, Clone)]
struct IdleSpan {
    last_activity: Observation,
    detected: ZonedObservation,
    returned: Option<ZonedObservation>,
}

/// Turns input activity and periodic checks into idle breaks.
#[derive(Debug)]
pub struct IdleTracker {
    threshold_ms: u64,
    last_activity: Observation,
    span: Option<IdleSpan>,
}

impl IdleTracker {
    pub fn new(now: Observation, threshold_ms: u64) -> Self {
        Self {
            threshold_ms,
            last_activity: now,
            span: None,
        }
    }

    /// Records input. The first input after idleness was detected is the return.
    pub fn activity(&mut self, now: Observation, zone: impl FnOnce() -> Option<String>) {
        if let Some(span) = &mut self.span {
            if span.returned.is_none() {
                span.returned = Some(ZonedObservation {
                    at: now,
                    timezone: zone(),
                });
            }
        }
        self.last_activity = now;
    }

    /// Periodic check. Detects idleness while clocked in and returns the break
    /// once the employee is back. Clocking out while idle discards the span.
    pub fn tick(
        &mut self,
        now: Observation,
        clocked_in: bool,
        zone: impl FnOnce() -> Option<String>,
    ) -> Option<IdleBreak> {
        if !clocked_in {
            self.span = None;
            return None;
        }
        match &self.span {
            None => {
                if now
                    .monotonic_ms
                    .saturating_sub(self.last_activity.monotonic_ms)
                    >= self.threshold_ms
                {
                    self.span = Some(IdleSpan {
                        last_activity: self.last_activity,
                        detected: ZonedObservation {
                            at: now,
                            timezone: zone(),
                        },
                        returned: None,
                    });
                }
                None
            }
            Some(span) if span.returned.is_some() => {
                let span = self.span.take()?;
                Some(IdleBreak {
                    id: uuid::Uuid::new_v4().hyphenated().to_string(),
                    last_activity: span.last_activity,
                    idle_detected: span.detected,
                    returned: span.returned?,
                })
            }
            Some(_) => None,
        }
    }
}
