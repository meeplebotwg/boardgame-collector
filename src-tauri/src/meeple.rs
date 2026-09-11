use tauri_plugin_http::reqwest::{Client, Url};

pub fn origin(value: &str) -> Result<String, String> {
    let invalid = || "HTTPS Tailscale origin required".to_string();
    if !value.starts_with("https://")
        || value
            .chars()
            .any(|c| c.is_whitespace() || ['\\', '?', '#', '@'].contains(&c))
    {
        return Err(invalid());
    }
    let url = Url::parse(value).map_err(|_| invalid())?;
    let host = url.host_str().ok_or_else(invalid)?;
    if !host.ends_with(".ts.net")
        || url.path() != "/"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port() == Some(0)
    {
        return Err(invalid());
    }
    if !host.split('.').all(|label| {
        !label.is_empty()
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    }) {
        return Err(invalid());
    }
    let normalized = url.origin().ascii_serialization();
    if value.trim_end_matches('/') != normalized {
        return Err(invalid());
    }
    Ok(normalized)
}

fn request_url(
    approved: &str,
    destination: &str,
    path: &str,
    body: Option<&str>,
) -> Result<Url, String> {
    let dest = origin(destination)?;
    if origin(approved)? != dest {
        return Err("Destination differs from approved exact endpoint".into());
    }
    let allowed = match body {
        Some(text) => path == "/v1/jobs" && !text.is_empty() && text.len() <= 128 * 1024,
        None => path.strip_prefix("/v1/jobs/").is_some_and(|id| {
            id.len() == 32
                && id
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        }),
    };
    if !allowed {
        return Err("Only bounded intake and receipt reads are allowed".into());
    }
    Url::parse(&(dest + path)).map_err(|_| "Invalid endpoint".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    const HOST: &str = "https://synthetic.tailnet.ts.net:9443";
    #[test]
    fn validates_exact_https_origin_not_url_tricks() {
        assert_eq!(origin(HOST).unwrap(), HOST);
        assert_eq!(origin(&(HOST.to_owned() + "/")).unwrap(), HOST);
        for bad in [
            "http://a.ts.net",
            "https://a.ts.net.evil.org",
            "https://user@a.ts.net",
            "https://a.ts.net/x",
            "https://a.ts.net?",
            "https://a.ts.net#",
            "https://a.ts.net\\@evil.org",
            "https://127.0.0.1",
            "https://a.ts.net:0",
        ] {
            assert!(origin(bad).is_err(), "{bad}");
        }
    }
    #[test]
    fn only_pinned_intake_and_status_paths() {
        assert_eq!(
            request_url(HOST, HOST, "/v1/jobs", Some("{}"))
                .unwrap()
                .as_str(),
            format!("{HOST}/v1/jobs")
        );
        assert!(request_url(HOST, HOST, &format!("/v1/jobs/{}", "a".repeat(32)), None).is_ok());
        for (dest, path, body) in [
            ("https://other.ts.net", "/v1/jobs", Some("{}")),
            (HOST, "/v1/jobs/../admin", None),
            (HOST, "/v1/jobs", None),
            (HOST, "/v1/jobs?x=1", Some("{}")),
        ] {
            assert!(request_url(HOST, dest, path, body).is_err());
        }
        assert!(request_url(HOST, HOST, "/v1/jobs", Some(&"x".repeat(131073))).is_err());
    }
    #[test]
    fn redirects_are_not_followed() {
        // Exercise the actual client against synthetic loopback; production URL validator never allows this host.
        use std::{
            io::{Read, Write},
            net::TcpListener,
            thread,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut b = [0; 1024];
            let n = s.read(&mut b).unwrap();
            assert!(n > 0);
            s.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/should-not-follow\r\nContent-Length: 0\r\n\r\n").unwrap();
        });
        let runtime = tauri::async_runtime::block_on(async {
            client()
                .unwrap()
                .get(format!("http://{addr}"))
                .send()
                .await
                .unwrap()
                .status()
                .as_u16()
        });
        worker.join().unwrap();
        assert_eq!(runtime, 302);
    }
}

fn client() -> Result<Client, String> {
    Client::builder()
        .redirect(tauri_plugin_http::reqwest::redirect::Policy::none())
        .no_proxy()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| "Cannot create private transport".into())
}

fn approve_pin(directory: &std::path::Path, value: &str) -> Result<(), String> {
    use std::io::Write;
    let normalized = origin(value)?;
    std::fs::create_dir_all(directory).map_err(|_| "Cannot save endpoint")?;
    let temp = directory.join("meeple-origin.tmp");
    let mut file = std::fs::File::create(&temp).map_err(|_| "Cannot save endpoint")?;
    file.write_all(normalized.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|_| "Cannot save endpoint")?;
    std::fs::rename(temp, directory.join("meeple-origin.txt"))
        .map_err(|_| "Cannot save endpoint")?;
    Ok(())
}
fn read_pin(directory: &std::path::Path) -> Result<String, String> {
    let text = std::fs::read_to_string(directory.join("meeple-origin.txt"))
        .map_err(|_| "Approve exact endpoint in app first")?;
    origin(&text)
}

use tauri::Manager;
#[tauri::command]
pub fn meeple_approve_origin(app: tauri::AppHandle, origin: String) -> Result<(), String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|_| "No app config directory")?;
    approve_pin(&directory, &origin)
}

#[tauri::command]
pub async fn meeple_request(
    app: tauri::AppHandle,
    origin: String,
    path: String,
    body: Option<String>,
) -> Result<String, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|_| "No app config directory")?;
    let url = request_url(&read_pin(&directory)?, &origin, &path, body.as_deref())?;
    let client = client()?;
    let request = if let Some(body) = body {
        client
            .post(url)
            .header("Content-Type", "application/json")
            .header("X-BGN-Handoff", "1")
            .body(body)
    } else {
        client.get(url)
    };
    // Native intentionally bypasses browser CORS, not TLS or endpoint authorization.
    let mut response = request
        .send()
        .await
        .map_err(|_| "Unknown delivery; check Tailscale and retry same batch")?;
    if !response.status().is_success() {
        return Err(format!(
            "Receiver HTTP {}; retry same batch",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Incomplete receiver response")?
    {
        if bytes.len() + chunk.len() > 512 * 1024 {
            return Err("Receiver response too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "Invalid receiver response".into())
}

#[cfg(test)]
mod pin_tests {
    use super::*;
    #[test]
    fn pin_survives_restart_and_refuses_invalid_replacement() {
        let path = std::env::temp_dir().join(format!("bgn-native-pin-{}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        assert!(read_pin(&path).is_err());
        approve_pin(&path, "https://synthetic.tailnet.ts.net:9443").unwrap();
        assert_eq!(
            read_pin(&path).unwrap(),
            "https://synthetic.tailnet.ts.net:9443"
        );
        assert!(approve_pin(&path, "https://evil.example.org").is_err());
        assert_eq!(
            read_pin(&path).unwrap(),
            "https://synthetic.tailnet.ts.net:9443"
        );
        std::fs::remove_dir_all(&path).unwrap();
    }
}
