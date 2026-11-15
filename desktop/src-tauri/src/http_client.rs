use std::time::Duration;
use wreq::Client;
use wreq_util::Emulation;

/// Builds a `wreq::Client` configured with browser TLS/HTTP2 fingerprint emulation.
pub fn build_browser_client() -> Result<Client, wreq::Error> {
    Client::builder()
        .emulation(Emulation::Chrome136)
        .cookie_store(true)
        .timeout(Duration::from_secs(120))
        .build()
}
