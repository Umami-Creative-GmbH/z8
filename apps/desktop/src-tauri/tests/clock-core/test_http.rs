//! Loopback HTTP at the real transport boundary: each response is served on
//! its own connection, and `None` drops the connection without answering.
use std::collections::BTreeSet;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Ports already given to a test. An endpoint is unbound between rounds, and
/// the OS may hand that port to a parallel test's `bind(0)`, so no port is
/// given out twice.
static HANDED_OUT: Mutex<BTreeSet<u16>> = Mutex::new(BTreeSet::new());

/// A local endpoint that refuses connections, as when the device is offline,
/// until `serve_on` answers on it.
pub fn free_endpoint() -> String {
    let mut handed_out = HANDED_OUT.lock().unwrap_or_else(|error| error.into_inner());
    loop {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        if handed_out.insert(address.port()) {
            return format!("http://{address}");
        }
    }
}

pub fn server<B: Into<String>>(
    responses: Vec<Option<(u16, B)>>,
) -> (String, std::thread::JoinHandle<Vec<String>>) {
    let mut responses: Vec<Option<(u16, String)>> = responses
        .into_iter()
        .map(|response| response.map(|(status, body)| (status, body.into())))
        .collect();
    responses.reverse();
    let count = responses.len();
    serve(count, move |_, _| responses.pop().unwrap())
}

/// Answers `count` requests; `respond` sees each request before it answers.
pub fn serve(
    count: usize,
    respond: impl FnMut(usize, &str) -> Option<(u16, String)> + Send + 'static,
) -> (String, std::thread::JoinHandle<Vec<String>>) {
    let endpoint = free_endpoint();
    let thread = serve_on(&endpoint, count, respond);
    (endpoint, thread)
}

pub fn serve_on(
    endpoint: &str,
    count: usize,
    mut respond: impl FnMut(usize, &str) -> Option<(u16, String)> + Send + 'static,
) -> std::thread::JoinHandle<Vec<String>> {
    let address = endpoint.trim_start_matches("http://");
    // A client connection may briefly hold the freed port as its local port.
    let deadline = Instant::now() + Duration::from_secs(5);
    let listener = loop {
        match TcpListener::bind(address) {
            Ok(listener) => break listener,
            Err(error)
                if error.kind() == std::io::ErrorKind::AddrInUse && Instant::now() < deadline =>
            {
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(error) => panic!("{error}"),
        }
    };
    listener.set_nonblocking(true).unwrap();
    std::thread::spawn(move || {
        let mut requests = Vec::new();
        for index in 0..count {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            Instant::now() < deadline,
                            "Expected another desktop request after {requests:#?}"
                        );
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("{error}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            loop {
                let mut buffer = [0; 4096];
                let size = stream.read(&mut buffer).unwrap();
                assert!(size > 0);
                request.extend_from_slice(&buffer[..size]);
                let text = String::from_utf8_lossy(&request);
                if let Some(end) = text.find("\r\n\r\n") {
                    let length = text[..end]
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            let request = String::from_utf8(request).unwrap();
            let response = respond(index, &request);
            requests.push(request);
            if let Some((status, body)) = response {
                write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        }
        requests
    })
}

pub fn request_line(request: &str) -> &str {
    request.lines().next().unwrap()
}

pub fn request_body(request: &str) -> &str {
    request.split_once("\r\n\r\n").unwrap().1
}
