fn main() {
    println!("cargo:rerun-if-env-changed=VITE_API_URL");

    let api_url = std::env::var("VITE_API_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_owned())
        .filter(|value| !value.is_empty());
    let is_release = std::env::var("PROFILE").is_ok_and(|profile| profile == "release");

    if is_release && api_url.is_none() {
        panic!("VITE_API_URL must be configured for production builds");
    }

    println!(
        "cargo:rustc-env=SILLAGE_API_URL={}",
        api_url.as_deref().unwrap_or("http://localhost:3001")
    );
    tauri_build::build()
}
