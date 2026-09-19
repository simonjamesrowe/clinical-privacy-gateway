fn main() {
    tauri_build::build();

    println!("cargo:rerun-if-env-changed=GITHUB_RUN_NUMBER");
    println!("cargo:rerun-if-env-changed=GITHUB_SHA");

    let build_number = std::env::var("GITHUB_RUN_NUMBER").unwrap_or_else(|_| "local".into());
    let revision: String = std::env::var("GITHUB_SHA")
        .map(|sha| sha.chars().take(7).collect::<String>())
        .unwrap_or_else(|_| "local".into());
    let channel = if build_number == "local" {
        "development"
    } else {
        "release"
    };

    println!("cargo:rustc-env=CLINICIANS_VEIL_BUILD_NUMBER={build_number}");
    println!("cargo:rustc-env=CLINICIANS_VEIL_REVISION={revision}");
    println!("cargo:rustc-env=CLINICIANS_VEIL_BUILD_CHANNEL={channel}");
}
