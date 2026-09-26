#![allow(dead_code)]

#[path = "../../src/clock.rs"]
mod clock;

#[path = "../../src/clock_command.rs"]
mod clock_command;

#[path = "../../src/offline.rs"]
mod offline;

#[path = "../../src/frozen_command.rs"]
mod frozen_command;

#[path = "../../src/command_store.rs"]
mod command_store;

#[path = "../../src/command_transport.rs"]
mod command_transport;

#[path = "../../src/command_sync.rs"]
mod command_sync;

#[path = "../../src/clock_journal.rs"]
mod clock_journal;

#[path = "../../src/break_evidence.rs"]
mod break_evidence;

#[cfg(test)]
mod storage_tests;

#[cfg(test)]
mod command_store_tests;

#[cfg(test)]
mod command_tests;

#[cfg(test)]
mod frozen_command_tests;

#[cfg(test)]
mod break_evidence_tests;

#[cfg(test)]
mod break_tests;

#[cfg(test)]
mod sync_tests;

#[cfg(test)]
mod support;

#[cfg(test)]
mod test_http;

#[cfg(test)]
mod tests {
    use super::clock::{ClockService, WorkLocationType};
    use std::io::{Read, Write};
    use std::net::TcpListener;

    // Real HTTP at the desktop service boundary; no mocked clock/persistence logic.
    #[tokio::test]
    async fn committed_clock_in_survives_failed_status_refresh() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for (status, body) in [
                (
                    "200 OK",
                    r#"{"entry":{"id":"entry-1","employeeId":"employee-1","type":"clock_in","timestamp":"2026-05-01T10:00:00Z"}}"#,
                ),
                ("503 Service Unavailable", "{}"),
            ] {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut buffer = [0; 8192];
                let size = stream.read(&mut buffer).unwrap();
                requests.push(String::from_utf8_lossy(&buffer[..size]).to_string());
                write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
            requests
        });

        let outcome = ClockService::new()
            .clock_in_with_status(&url, "test-token", WorkLocationType::Remote)
            .await
            .unwrap();

        assert!(outcome.status.is_none());
        assert!(outcome.status_refresh_failed);
        assert_eq!(outcome.entries[0].id, "entry-1");
        let requests = server.join().unwrap();
        assert!(requests[0].starts_with("POST /api/time-entries "));
        assert!(requests[1].starts_with("GET /api/time-entries/status "));
        assert_eq!(requests.len(), 2);
    }
}
