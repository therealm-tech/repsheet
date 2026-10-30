use std::net::SocketAddr;

use clap::{Args, Parser, Subcommand, ValueEnum};

#[derive(Parser)]
#[command(version, about = "RepSheet HTTP API")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,

    /// `tracing` filter directive (e.g. `info`, `repsheet_api=debug,sqlx=warn`)
    ///
    /// Syntax: <https://docs.rs/tracing-subscriber/latest/tracing_subscriber/filter/struct.EnvFilter.html#directives>
    #[arg(long, env = "LOG_FILTER", default_value = "info", global = true)]
    pub log_filter: String,

    /// Log output format
    #[arg(long, env = "LOG_FORMAT", value_enum, default_value_t = LogFormat::Text, global = true)]
    pub log_format: LogFormat,
}

#[derive(Clone, Copy, ValueEnum)]
pub enum LogFormat {
    Text,
    Json,
}

#[derive(Subcommand)]
pub enum Command {
    /// Apply the database migrations and serve the HTTP API
    Serve(ServeArgs),
    /// Probe the health endpoint of a server running on this host; exits
    /// non-zero when it does not answer 200
    Healthcheck(HealthcheckArgs),
}

#[derive(Args)]
pub struct ServeArgs {
    /// Address the HTTP server listens on
    #[arg(long, env = "BIND_ADDR", default_value_t = default_bind_addr())]
    pub bind_addr: SocketAddr,

    /// PostgreSQL connection string
    #[arg(long, env = "DATABASE_URL")]
    pub database_url: String,

    /// Maximum number of connections in the database pool
    #[arg(long, env = "DB_MAX_CONNECTIONS", default_value_t = 10)]
    pub db_max_connections: u32,

    /// Lifetime of an access token, in days
    #[arg(long, env = "TOKEN_TTL_DAYS", default_value_t = 30)]
    pub token_ttl_days: u16,

    /// Email of the super admin account, created or updated on start-up
    #[arg(long, env = "SUPER_ADMIN_EMAIL")]
    pub super_admin_email: String,

    /// Password of the super admin account (at least 8 characters), applied
    /// on every start-up
    #[arg(long, env = "SUPER_ADMIN_PASSWORD", hide_env_values = true)]
    pub super_admin_password: String,
}

#[derive(Args)]
pub struct HealthcheckArgs {
    /// Address the server listens on; the probe connects to its port on
    /// 127.0.0.1
    #[arg(long, env = "BIND_ADDR", default_value_t = default_bind_addr())]
    pub bind_addr: SocketAddr,
}

fn default_bind_addr() -> SocketAddr {
    SocketAddr::from(([0, 0, 0, 0], 3000))
}
