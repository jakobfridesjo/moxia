#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Could not read or write a file: {0}")]
    Io(#[from] std::io::Error),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Database migration failed: {0}")]
    Migration(#[from] rusqlite_migration::Error),
    #[error("Stored data is unreadable: {0}")]
    Stored(#[from] serde_json::Error),
    #[error("Could not reach the radio directory: {0}")]
    Directory(String),
    #[error("Could not play the station: {0}")]
    Stream(String),
    #[error("Could not play the station: {0} streams are not supported")]
    UnsupportedStream(&'static str),
    #[error("No sound output: {0}")]
    Output(String),
    #[error("{0}")]
    /// A request that cannot be done, in a sentence for the listener.
    Refused(String),
    #[error("Could not download the model: {0}")]
    Download(String),
    #[error("Could not translate: {0}")]
    Translation(String),
    #[error("Could not get the weather: {0}")]
    Weather(String),
    #[error("Could not reach the others: {0}")]
    Together(String),
}

pub type Result<T> = std::result::Result<T, Error>;
