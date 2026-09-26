//! Loopback HTTP at the real transport boundary: each response is served on
//! its own connection, and `None` drops the connection without answering.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

/// A local endpoint that refuses connections, as when the device is offline,
/// until `serve_on` answers on it.
pub fn free_endpoint() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    format!("http://{}", listener.local_addr().unwrap())
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
    let listener = TcpListener::bind(endpoint.trim_start_matches("http://")).unwrap();
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
