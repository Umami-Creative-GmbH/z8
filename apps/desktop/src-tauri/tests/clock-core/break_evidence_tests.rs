//! Idle-break observation (#281): estimated start, detected return, endpoint
//! zones and wall/monotonic agreement.
use crate::break_evidence::{
    clocks_agree, BreakEvidence, BreakReview, IdleTracker, Observation, ZonedObservation,
};
use chrono::{DateTime, Duration, TimeZone, Utc};

const THRESHOLD_MS: u64 = 5 * 60 * 1000;

fn base() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 20, 10, 0, 5).unwrap() + Duration::milliseconds(123)
}

/// An observation `ms` after the base, on both clocks.
fn at(ms: i64) -> Observation {
    Observation {
        utc: base() + Duration::milliseconds(ms),
        monotonic_ms: (7_200_000 + ms) as u64,
    }
}

fn zone(name: &str) -> impl FnOnce() -> Option<String> + '_ {
    move || Some(name.to_string())
}

#[test]
fn a_break_runs_from_the_last_input_to_the_first_input_after_idleness() {
    let mut tracker = IdleTracker::new(at(-60_000), THRESHOLD_MS);
    tracker.activity(at(0), zone("Europe/Madrid"));
    assert_eq!(tracker.tick(at(299_999), true, zone("Europe/Lisbon")), None);
    // Idleness is noticed here; the zone observed now belongs to the start.
    assert_eq!(tracker.tick(at(303_000), true, zone("Europe/Lisbon")), None);
    assert_eq!(tracker.tick(at(600_000), true, zone("Asia/Tokyo")), None);
    // The first input after idleness is the return, with the zone read then.
    tracker.activity(at(1_794_000), zone("Europe/Berlin"));
    tracker.activity(at(1_795_000), zone("America/New_York"));

    let idle = tracker
        .tick(at(1_800_000), true, zone("Asia/Tokyo"))
        .expect("the return ends the idle span");

    assert_eq!(idle.last_activity, at(0));
    assert_eq!(
        idle.idle_detected,
        ZonedObservation {
            at: at(303_000),
            timezone: Some("Europe/Lisbon".into()),
        }
    );
    assert_eq!(
        idle.returned,
        ZonedObservation {
            at: at(1_794_000),
            timezone: Some("Europe/Berlin".into()),
        }
    );
    assert_eq!(idle.idle_ms(), 1_794_000);
    assert_eq!(idle.review(), None);
    // The span is reported once.
    assert_eq!(
        tracker.tick(at(1_810_000), true, zone("Europe/Berlin")),
        None
    );
}

#[test]
fn idleness_counts_only_while_clocked_in() {
    let mut tracker = IdleTracker::new(at(0), THRESHOLD_MS);
    assert_eq!(tracker.tick(at(400_000), false, zone("UTC")), None);
    tracker.activity(at(500_000), zone("UTC"));
    assert_eq!(tracker.tick(at(510_000), true, zone("UTC")), None);

    // Idle while clocked in, then clocked out elsewhere before returning.
    let mut tracker = IdleTracker::new(at(0), THRESHOLD_MS);
    assert_eq!(tracker.tick(at(300_000), true, zone("UTC")), None);
    assert_eq!(tracker.tick(at(400_000), false, zone("UTC")), None);
    tracker.activity(at(500_000), zone("UTC"));
    assert_eq!(tracker.tick(at(510_000), true, zone("UTC")), None);
}

#[test]
fn unreadable_zones_require_a_reviewed_correction() {
    let mut tracker = IdleTracker::new(at(0), THRESHOLD_MS);
    tracker.tick(at(300_000), true, || None);
    tracker.activity(at(900_000), zone("Europe/Berlin"));
    let idle = tracker.tick(at(910_000), true, zone("UTC")).unwrap();
    assert_eq!(idle.review(), Some(BreakReview::StartZoneUnavailable));

    let mut tracker = IdleTracker::new(at(0), THRESHOLD_MS);
    tracker.tick(at(300_000), true, zone("Europe/Berlin"));
    tracker.activity(at(900_000), || None);
    let idle = tracker.tick(at(910_000), true, zone("UTC")).unwrap();
    assert_eq!(idle.review(), Some(BreakReview::ReturnZoneUnavailable));
}

#[test]
fn a_wall_clock_change_while_idle_requires_a_reviewed_correction() {
    let mut tracker = IdleTracker::new(at(0), THRESHOLD_MS);
    tracker.tick(at(300_000), true, zone("Europe/Berlin"));
    // The wall clock is set one hour ahead while the device is idle.
    let mut returned = at(900_000);
    returned.utc = returned.utc + Duration::hours(1);
    tracker.activity(returned, zone("Europe/Berlin"));
    let idle = tracker.tick(at(910_000), true, zone("UTC")).unwrap();
    assert_eq!(idle.review(), Some(BreakReview::ClockDiscontinuity));

    // A change between return and confirmation is caught at confirmation.
    let mut tracker = IdleTracker::new(at(0), THRESHOLD_MS);
    tracker.tick(at(300_000), true, zone("Europe/Berlin"));
    tracker.activity(at(900_000), zone("Europe/Berlin"));
    let idle = tracker.tick(at(910_000), true, zone("UTC")).unwrap();
    let mut confirmed = at(1_200_000);
    confirmed.utc = confirmed.utc - Duration::minutes(10);
    let evidence = BreakEvidence { idle, confirmed };
    assert_eq!(evidence.review(), Some(BreakReview::ClockDiscontinuity));
}

#[test]
fn clocks_agree_within_the_servers_tolerance() {
    // The same boundary as the server's checkBreakClockContinuity test: 303 s of
    // wall time against 305.305 s of monotonic time is within, 305.306 s is not.
    let shifted = |drift: u64| {
        let mut later = at(303_000);
        later.monotonic_ms += drift;
        [at(0), later]
    };
    assert!(clocks_agree(&shifted(2_305)));
    assert!(!clocks_agree(&shifted(2_306)));
    // Monotonic time never runs backwards.
    let mut backwards = at(0);
    backwards.monotonic_ms -= 1;
    assert!(!clocks_agree(&[at(0), backwards]));
}
