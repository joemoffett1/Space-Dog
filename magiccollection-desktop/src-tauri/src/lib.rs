use chrono::Utc;
use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, ACCEPT_LANGUAGE, CONNECTION, REFERER, USER_AGENT};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::{Manager, State};
use uuid::Uuid;

const MIGRATION_SQL_0004: &str = include_str!("../migrations/0004_schema_groups_v2.sql");
const MIGRATION_SQL_0005: &str = include_str!("../migrations/0005_drop_legacy_tables.sql");
const MIGRATION_SQL_0006: &str = include_str!("../migrations/0006_price_channels_expand.sql");
const MIGRATION_SQL_0007: &str = include_str!("../migrations/0007_price_backfill_tcg_channels.sql");
const MIGRATION_SQL_0008: &str = include_str!("../migrations/0008_compact_price_rows.sql");
const MIGRATION_SQL_0009: &str = include_str!("../migrations/0009_drop_tcg_mid.sql");
const MIGRATION_SQL_0010: &str = include_str!("../migrations/0010_price_lookup_index.sql");
const SCHEMA_CURRENT_SQL: &str = include_str!("../migrations/schema_current.sql");
const CATALOG_DATASET_DEFAULT: &str = "default_cards";
const CK_PRICELIST_URL: &str = "https://api.cardkingdom.com/api/v2/pricelist";
const CK_PRICELIST_CACHE_FILE: &str = "ck_pricelist_cache.json";
const CK_PRICELIST_CACHE_MAX_AGE_SECONDS: u64 = 60 * 60 * 12;
const FILTER_TOKEN_DEFAULT_LIMIT: i64 = 30;
const LOCAL_SYNC_CLIENT_ID: &str = "local-desktop";
const SCRYFALL_SOURCE_ID: &str = "scryfall_default_cards";
const TCGTRACKING_SOURCE_ID: &str = "tcgtracking_tcgplayer";
const CK_SOURCE_ID: &str = "ck_buylist";
const CONDITION_NM_ID: i64 = 1;
const FINISH_NONFOIL_ID: i64 = 1;
const SYNC_YIELD_EVERY_ROWS: i64 = 500;
const SYNC_YIELD_SLEEP_MS: u64 = 2;

#[derive(Clone)]
struct AppState {
  db_path: PathBuf,
  app_data_dir: PathBuf,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProfileDto {
  id: String,
  name: String,
  created_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OwnedCardDto {
  scryfall_id: String,
  name: String,
  set_code: String,
  collector_number: String,
  image_url: Option<String>,
  type_line: Option<String>,
  color_identity: Vec<String>,
  mana_value: Option<f64>,
  rarity: Option<String>,
  quantity: i64,
  foil_quantity: i64,
  updated_at: String,
  tags: Vec<String>,
  current_price: Option<f64>,
  previous_price: Option<f64>,
  price_delta: Option<f64>,
  price_direction: String,
  last_price_at: Option<String>,
  condition_code: String,
  language: String,
  location_name: Option<String>,
  notes: Option<String>,
  purchase_price: Option<f64>,
  date_added: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MarketTrendDto {
  scryfall_id: String,
  current_price: Option<f64>,
  previous_price: Option<f64>,
  price_delta: Option<f64>,
  price_direction: String,
  last_price_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddCardInput {
  profile_id: String,
  scryfall_id: String,
  name: String,
  set_code: String,
  collector_number: String,
  image_url: Option<String>,
  type_line: Option<String>,
  color_identity: Option<Vec<String>>,
  mana_value: Option<f64>,
  rarity: Option<String>,
  foil: bool,
  current_price: Option<f64>,
  tags: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuantityInput {
  profile_id: String,
  scryfall_id: String,
  foil: bool,
  delta: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveCardInput {
  profile_id: String,
  scryfall_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveCardsInput {
  profile_id: String,
  scryfall_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BulkUpdateTagsInput {
  profile_id: String,
  scryfall_ids: Vec<String>,
  tags: Vec<String>,
  include_auto_rules: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateOwnedCardMetadataInput {
  profile_id: String,
  scryfall_id: String,
  condition_code: Option<String>,
  language: Option<String>,
  location_name: Option<String>,
  notes: Option<String>,
  purchase_price: Option<f64>,
  date_added: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetOwnedCardStateCardInput {
  scryfall_id: String,
  name: String,
  set_code: String,
  collector_number: String,
  image_url: Option<String>,
  type_line: Option<String>,
  color_identity: Option<Vec<String>>,
  mana_value: Option<f64>,
  rarity: Option<String>,
  quantity: i64,
  foil_quantity: i64,
  condition_code: Option<String>,
  language: Option<String>,
  location_name: Option<String>,
  notes: Option<String>,
  purchase_price: Option<f64>,
  date_added: Option<String>,
  #[serde(default)]
  tags: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetOwnedCardStateInput {
  profile_id: String,
  card: SetOwnedCardStateCardInput,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportCollectionRowInput {
  scryfall_id: String,
  name: String,
  set_code: String,
  collector_number: String,
  image_url: Option<String>,
  type_line: Option<String>,
  color_identity: Option<Vec<String>>,
  mana_value: Option<f64>,
  rarity: Option<String>,
  quantity: i64,
  foil_quantity: i64,
  tags: Option<Vec<String>>,
  condition_code: Option<String>,
  language: Option<String>,
  location_name: Option<String>,
  notes: Option<String>,
  purchase_price: Option<f64>,
  date_added: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportCollectionInput {
  profile_id: String,
  rows: Vec<ImportCollectionRowInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HydrateProfileCardMetadataInput {
  profile_id: String,
  max_cards: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HydrateProfileCardMetadataResult {
  attempted: i64,
  hydrated: i64,
  remaining: i64,
}

#[derive(Serialize)]
struct ScryfallCollectionRequest {
  identifiers: Vec<ScryfallCollectionIdentifier>,
}

#[derive(Serialize)]
struct ScryfallCollectionIdentifier {
  id: String,
}

#[derive(Deserialize)]
struct ScryfallCollectionResponse {
  data: Vec<ScryfallCollectionCard>,
}

#[derive(Deserialize)]
struct ScryfallBulkDataListResponse {
  data: Vec<ScryfallBulkDataItem>,
}

#[derive(Deserialize)]
struct ScryfallBulkDataItem {
  #[serde(rename = "type")]
  bulk_type: String,
  download_uri: Option<String>,
}

#[derive(Deserialize)]
struct ScryfallCollectionCard {
  id: String,
  name: Option<String>,
  oracle_id: Option<String>,
  set: Option<String>,
  set_name: Option<String>,
  collector_number: Option<String>,
  released_at: Option<String>,
  lang: Option<String>,
  mana_cost: Option<String>,
  type_line: Option<String>,
  oracle_text: Option<String>,
  reserved: Option<bool>,
  keywords: Option<Vec<String>>,
  colors: Option<Vec<String>>,
  color_identity: Option<Vec<String>>,
  cmc: Option<f64>,
  rarity: Option<String>,
  layout: Option<String>,
  artist: Option<String>,
  tcgplayer_id: Option<i64>,
  cardmarket_id: Option<i64>,
  mtgo_id: Option<i64>,
  mtgo_foil_id: Option<i64>,
  digital: Option<bool>,
  finishes: Option<Vec<String>>,
  image_uris: Option<ScryfallImageUris>,
  card_faces: Option<Vec<ScryfallCardFace>>,
}

#[derive(Deserialize)]
struct ScryfallImageUris {
  normal: Option<String>,
  small: Option<String>,
  art_crop: Option<String>,
}

#[derive(Deserialize)]
struct ScryfallCardFace {
  image_uris: Option<ScryfallImageUris>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketSnapshotInput {
  scryfall_id: String,
  name: String,
  set_code: String,
  collector_number: String,
  image_url: Option<String>,
  market_price: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CkQuoteRequestItem {
  scryfall_id: String,
  name: String,
  quantity: i64,
  foil_quantity: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CkQuoteDto {
  scryfall_id: String,
  name: String,
  quantity: i64,
  cash_price: f64,
  credit_price: f64,
  qty_cap: i64,
  source_url: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CkPriceSyncResultDto {
  scanned: i64,
  upserted_buylist: i64,
  upserted_sell: i64,
  skipped: i64,
}

#[derive(Deserialize)]
struct CkPricelistItem {
  scryfall_id: Option<String>,
  is_foil: Option<String>,
  price_buy: Option<String>,
  #[serde(alias = "price_sell", alias = "sell_price", alias = "price_retail", alias = "retail_price")]
  price_sell: Option<String>,
  qty_buying: Option<i64>,
  url: Option<String>,
}

#[derive(Deserialize)]
struct CkPricelistPayload {
  data: Vec<CkPricelistItem>,
}

#[derive(Deserialize)]
struct TcgTrackingSetListResponse {
  sets: Vec<TcgTrackingSetListItem>,
}

#[derive(Deserialize)]
struct TcgTrackingSetListItem {
  id: i64,
}

#[derive(Deserialize)]
struct TcgTrackingSetProductsResponse {
  #[allow(dead_code)]
  set_id: i64,
  products: std::collections::BTreeMap<String, TcgTrackingProductItem>,
}

#[derive(Deserialize)]
struct TcgTrackingProductItem {
  id: i64,
  scryfall_id: Option<String>,
}

#[derive(Deserialize)]
struct TcgTrackingSetPricingResponse {
  #[allow(dead_code)]
  set_id: i64,
  prices: std::collections::BTreeMap<String, TcgTrackingPriceItem>,
}

#[derive(Deserialize)]
struct TcgTrackingPriceItem {
  tcg: Option<TcgTrackingPriceByFinish>,
}

#[derive(Deserialize)]
struct TcgTrackingPriceByFinish {
  #[serde(rename = "Normal")]
  normal: Option<TcgTrackingPricePoint>,
  #[serde(rename = "Foil")]
  foil: Option<TcgTrackingPricePoint>,
}

#[derive(Deserialize, Clone, Copy)]
struct TcgTrackingPricePoint {
  low: Option<f64>,
  market: Option<f64>,
}

#[derive(Deserialize)]
struct TcgTrackingSetSkusResponse {
  #[allow(dead_code)]
  set_id: i64,
  products: std::collections::BTreeMap<String, std::collections::BTreeMap<String, TcgTrackingSkuItem>>,
}

#[derive(Deserialize)]
struct TcgTrackingSkuItem {
  cnd: Option<String>,
  var: Option<String>,
  lng: Option<String>,
  hi: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FullSourceSyncResultDto {
  started_at: String,
  finished_at: String,
  sync_version: String,
  scryfall_scanned: i64,
  scryfall_updated: i64,
  scryfall_unchanged: i64,
  scryfall_price_snapshots: i64,
  tcg_sets_scanned: i64,
  tcg_products_matched: i64,
  tcg_price_upserts: i64,
  ck_scanned: i64,
  ck_upserted_buylist: i64,
  ck_upserted_sell: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CatalogPriceRecordDto {
  scryfall_id: String,
  name: String,
  set_code: String,
  collector_number: String,
  image_url: Option<String>,
  market_price: f64,
  #[serde(default)]
  low_price: Option<f64>,
  #[serde(default)]
  mid_price: Option<f64>,
  #[serde(default)]
  high_price: Option<f64>,
  updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CatalogSyncStateDto {
  dataset: String,
  current_version: Option<String>,
  state_hash: Option<String>,
  synced_at: Option<String>,
  total_records: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CatalogApplyResultDto {
  dataset: String,
  from_version: Option<String>,
  to_version: String,
  strategy: String,
  patch_hash: Option<String>,
  state_hash: String,
  total_records: i64,
  added_count: i64,
  updated_count: i64,
  removed_count: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FilterTokenDto {
  token: String,
  label: String,
  kind: String,
  source: String,
  priority: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FilterTokenQueryInput {
  query: Option<String>,
  limit: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogPatchApplyInput {
  dataset: Option<String>,
  from_version: String,
  to_version: String,
  added: Vec<CatalogPriceRecordDto>,
  updated: Vec<CatalogPriceRecordDto>,
  removed: Vec<String>,
  patch_hash: Option<String>,
  strategy: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogSnapshotApplyInput {
  dataset: Option<String>,
  version: String,
  records: Vec<CatalogPriceRecordDto>,
  snapshot_hash: Option<String>,
  strategy: Option<String>,
}

#[derive(Clone)]
struct PriceTrend {
  current_price: Option<f64>,
  previous_price: Option<f64>,
  price_delta: Option<f64>,
  price_direction: String,
  last_price_at: Option<String>,
}

fn now_iso() -> String {
  Utc::now().to_rfc3339()
}

fn init_database(db_path: &PathBuf) -> Result<(), String> {
  if let Some(parent) = db_path.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }

  let connection = Connection::open(db_path).map_err(|e| e.to_string())?;
  connection
    .execute_batch("PRAGMA foreign_keys = ON;")
    .map_err(|e| e.to_string())?;
  connection
    .execute(
      "CREATE TABLE IF NOT EXISTS _app_migrations (
         name TEXT PRIMARY KEY,
         applied_at TEXT NOT NULL
       )",
      [],
    )
    .map_err(|e| e.to_string())?;

  if is_fresh_database(&connection)? {
    connection
      .execute_batch(SCHEMA_CURRENT_SQL)
      .map_err(|e| e.to_string())?;
    for migration_name in [
      "0004_schema_groups_v2.sql",
      "0005_drop_legacy_tables.sql",
      "0006_price_channels_expand.sql",
      "0007_price_backfill_tcg_channels.sql",
      "0008_compact_price_rows.sql",
      "0009_drop_tcg_mid.sql",
      "0010_price_lookup_index.sql",
    ] {
      mark_migration_applied(&connection, migration_name)?;
    }
    mark_migration_applied(&connection, "schema_current.sql")?;
    return Ok(());
  }

  apply_migration_once(&connection, "0004_schema_groups_v2.sql", MIGRATION_SQL_0004)?;
  apply_migration_once(&connection, "0005_drop_legacy_tables.sql", MIGRATION_SQL_0005)?;
  apply_migration_once(&connection, "0006_price_channels_expand.sql", MIGRATION_SQL_0006)?;
  apply_migration_once(&connection, "0007_price_backfill_tcg_channels.sql", MIGRATION_SQL_0007)?;
  apply_migration_once(&connection, "0008_compact_price_rows.sql", MIGRATION_SQL_0008)?;
  apply_migration_once(&connection, "0009_drop_tcg_mid.sql", MIGRATION_SQL_0009)?;
  apply_migration_once(&connection, "0010_price_lookup_index.sql", MIGRATION_SQL_0010)?;
  Ok(())
}

fn is_fresh_database(connection: &Connection) -> Result<bool, String> {
  let table_count: i64 = connection
    .query_row(
      "SELECT COUNT(*)
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name <> '_app_migrations'",
      [],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())?;
  Ok(table_count == 0)
}

fn mark_migration_applied(connection: &Connection, name: &str) -> Result<(), String> {
  connection
    .execute(
      "INSERT OR IGNORE INTO _app_migrations (name, applied_at) VALUES (?1, ?2)",
      params![name, now_iso()],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

fn apply_migration_once(connection: &Connection, name: &str, sql: &str) -> Result<(), String> {
  let exists: Option<String> = connection
    .query_row(
      "SELECT name FROM _app_migrations WHERE name = ?1 LIMIT 1",
      params![name],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?;
  if exists.is_some() {
    return Ok(());
  }
  connection.execute_batch(sql).map_err(|e| e.to_string())?;
  connection
    .execute(
      "INSERT INTO _app_migrations (name, applied_at) VALUES (?1, ?2)",
      params![name, now_iso()],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

fn open_database(db_path: &PathBuf) -> Result<Connection, String> {
  let connection = Connection::open(db_path).map_err(|e| e.to_string())?;
  connection
    .execute_batch("PRAGMA foreign_keys = ON;")
    .map_err(|e| e.to_string())?;
  Ok(connection)
}

fn normalize_catalog_dataset(dataset: Option<&str>) -> Result<String, String> {
  let normalized = dataset
    .unwrap_or(CATALOG_DATASET_DEFAULT)
    .trim()
    .to_lowercase();
  if normalized.is_empty() {
    return Ok(CATALOG_DATASET_DEFAULT.to_string());
  }
  if normalized != CATALOG_DATASET_DEFAULT {
    return Err(format!(
      "Unsupported dataset '{}'. Only '{}' is currently supported.",
      normalized, CATALOG_DATASET_DEFAULT
    ));
  }
  Ok(normalized)
}

fn current_sync_version() -> String {
  format!("v{}", Utc::now().format("%y%m%d"))
}

fn current_captured_ymd() -> i64 {
  Utc::now()
    .format("%Y%m%d")
    .to_string()
    .parse::<i64>()
    .unwrap_or(0)
}

fn sync_version_from_iso(timestamp: &str) -> String {
  if timestamp.len() >= 10 {
    let ymd = timestamp[2..10].replace('-', "");
    if ymd.len() == 6 {
      return format!("v{}", ymd);
    }
  }
  current_sync_version()
}

fn captured_ymd_from_iso(timestamp: &str) -> Option<i64> {
  if timestamp.len() < 10 {
    return None;
  }
  timestamp[0..10].replace('-', "").parse::<i64>().ok()
}

fn captured_ymd_from_sync_version(sync_version: &str) -> Option<i64> {
  if sync_version.len() == 7 && sync_version.starts_with('v') {
    let digits = &sync_version[1..];
    if digits.chars().all(|ch| ch.is_ascii_digit()) {
      return format!("20{}", digits).parse::<i64>().ok();
    }
  }
  None
}

fn read_catalog_sync_row(
  connection: &Connection,
  dataset: &str,
) -> Result<(Option<String>, Option<String>, Option<String>), String> {
  let state = connection
    .query_row(
      "SELECT current_version, state_hash, synced_at
       FROM system_data_sync_client_sync_state
       WHERE client_id = ?1
         AND dataset_name = ?2
       LIMIT 1",
      params![LOCAL_SYNC_CLIENT_ID, dataset],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  Ok(state.unwrap_or((None, None, None)))
}

fn count_catalog_records_for_version(connection: &Connection, sync_version: &str) -> Result<i64, String> {
  connection
    .query_row(
      "SELECT COUNT(DISTINCT printing_id)
       FROM card_data_card_prices
       WHERE sync_version = ?1
         AND tcg_market IS NOT NULL",
      params![sync_version],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn count_catalog_records(connection: &Connection, dataset: &str) -> Result<i64, String> {
  let (current_version, _, _) = read_catalog_sync_row(connection, dataset)?;
  let Some(version) = current_version else {
    return Ok(0);
  };
  if version.trim().is_empty() {
    return Ok(0);
  }
  connection
    .query_row(
      "SELECT COUNT(DISTINCT printing_id)
       FROM card_data_card_prices
       WHERE sync_version = ?1
         AND tcg_market IS NOT NULL",
      params![version],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn write_catalog_sync_state(
  connection: &Connection,
  dataset: &str,
  current_version: Option<&str>,
  state_hash: Option<&str>,
) -> Result<(), String> {
  let now = now_iso();
  connection
    .execute(
      "INSERT INTO system_data_sync_client_sync_state
         (client_id, dataset_name, current_version, state_hash, synced_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(client_id, dataset_name) DO UPDATE SET
         current_version = excluded.current_version,
         state_hash = excluded.state_hash,
         synced_at = excluded.synced_at,
         updated_at = excluded.updated_at",
      params![LOCAL_SYNC_CLIENT_ID, dataset, current_version, state_hash, now],
    )
    .map_err(|e| e.to_string())?;

  if let Some(version) = current_version {
    let normalized_version = version.trim();
    if !normalized_version.is_empty() {
      let record_count = count_catalog_records_for_version(connection, normalized_version)?;
      connection
        .execute(
          "INSERT INTO system_data_sync_dataset_versions
             (id, source_id, dataset_name, build_version, state_hash, record_count, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT(id) DO UPDATE SET
             state_hash = excluded.state_hash,
             record_count = excluded.record_count,
             created_at = excluded.created_at",
          params![
            format!("{}:{}", dataset, normalized_version),
            SCRYFALL_SOURCE_ID,
            dataset,
            normalized_version,
            state_hash,
            record_count,
            now
          ],
        )
        .map_err(|e| e.to_string())?;
    }
  }
  Ok(())
}

fn upsert_catalog_record(
  connection: &Connection,
  row: &CatalogPriceRecordDto,
  sync_version: &str,
) -> Result<(), String> {
  let normalized_scryfall_id = row.scryfall_id.trim().to_lowercase();
  let normalized_set = row.set_code.trim().to_lowercase();
  let normalized_number = row.collector_number.trim().to_string();
  let normalized_name = row.name.trim().to_string();
  let updated_at = if row.updated_at.trim().is_empty() {
    now_iso()
  } else {
    row.updated_at.trim().to_string()
  };
  let captured_ymd = captured_ymd_from_sync_version(sync_version)
    .or_else(|| captured_ymd_from_iso(&updated_at))
    .unwrap_or_else(current_captured_ymd);
  let inferred_set_name = if normalized_set.is_empty() {
    "UNKNOWN".to_string()
  } else {
    normalized_set.to_uppercase()
  };

  if normalized_scryfall_id.is_empty() {
    return Err("Catalog row has empty scryfallId.".to_string());
  }

  if !row.market_price.is_finite() || row.market_price < 0.0 {
    return Err(format!(
      "Catalog row {} has invalid marketPrice: {}",
      row.scryfall_id, row.market_price
    ));
  }

  connection
    .execute(
      "INSERT INTO card_data_sets (set_code, set_name, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(set_code) DO UPDATE SET
         set_name = COALESCE(NULLIF(excluded.set_name, ''), card_data_sets.set_name),
         updated_at = excluded.updated_at",
      params![normalized_set, inferred_set_name, updated_at],
    )
    .map_err(|e| e.to_string())?;

  let existing_card_id: Option<String> = connection
    .query_row(
      "SELECT card_id
       FROM card_data_printings
       WHERE id = ?1
       LIMIT 1",
      params![normalized_scryfall_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?;
  let card_id = existing_card_id.unwrap_or_else(|| format!("scryfall:{}", normalized_scryfall_id));

  connection
    .execute(
      "INSERT INTO card_data_cards (
         id, oracle_id, name, mana_cost, cmc, type_line, oracle_text, reserved,
         keywords_json, colors_json, color_identity_json, latest_released_at, created_at, updated_at
       )
       VALUES (?1, NULL, ?2, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, ?3, ?3)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         updated_at = excluded.updated_at",
      params![card_id, normalized_name, updated_at],
    )
    .map_err(|e| e.to_string())?;

  connection
    .execute(
      "INSERT INTO card_data_printings (
          id, card_id, oracle_id, set_code, collector_number, lang, rarity, layout, released_at, artist,
          image_normal_url, image_small_url, image_art_crop_url, image_png_url, is_token, is_digital,
          is_foil_available, is_nonfoil_available, tcgplayer_id, cardmarket_id, mtgo_id, mtgo_foil_id,
          created_at, updated_at
        )
        VALUES (?1, ?2, NULL, ?3, ?4, 'en', NULL, NULL, NULL, NULL, ?5, NULL, NULL, NULL, 0, 0, 1, 1, NULL, NULL, NULL, NULL, ?6, ?6)
        ON CONFLICT(id) DO UPDATE SET
          card_id = COALESCE(card_data_printings.card_id, excluded.card_id),
          set_code = excluded.set_code,
          collector_number = excluded.collector_number,
          image_normal_url = COALESCE(excluded.image_normal_url, card_data_printings.image_normal_url),
          updated_at = excluded.updated_at",
      params![
        normalized_scryfall_id,
        card_id,
        normalized_set,
        normalized_number,
        row.image_url.as_deref(),
        updated_at
      ],
    )
    .map_err(|e| e.to_string())?;

  let low_price = row.low_price.unwrap_or(row.market_price);
  let high_price = row.high_price.unwrap_or(row.market_price);

  upsert_compact_price_row(
    connection,
    &normalized_scryfall_id,
    Some(CONDITION_NM_ID),
    Some(FINISH_NONFOIL_ID),
    Some(low_price),
    Some(row.market_price),
    Some(high_price),
    None,
    None,
    None,
    sync_version,
    captured_ymd,
    &updated_at,
  )?;
  Ok(())
}

fn compute_catalog_state_hash(connection: &Connection, dataset: &str) -> Result<String, String> {
  let (current_version, _, _) = read_catalog_sync_row(connection, dataset)?;
  let Some(sync_version) = current_version else {
    let mut hasher = Sha256::new();
    hasher.update(dataset.as_bytes());
    hasher.update(b"\n");
    return Ok(format!("{:x}", hasher.finalize()));
  };

  let mut statement = connection
    .prepare(
      "SELECT p.id, c.name, p.set_code, p.collector_number, COALESCE(p.image_normal_url, ''), cp.tcg_market, cp.captured_at
       FROM card_data_card_prices cp
       JOIN card_data_printings p ON p.id = cp.printing_id
       JOIN card_data_cards c ON c.id = p.card_id
       WHERE cp.sync_version = ?1
         AND cp.tcg_market IS NOT NULL
       ORDER BY p.id",
    )
    .map_err(|e| e.to_string())?;

  let mut rows = statement
    .query(params![sync_version])
    .map_err(|e| e.to_string())?;
  let mut hasher = Sha256::new();
  hasher.update(dataset.as_bytes());
  hasher.update(b"\n");

  while let Some(row) = rows.next().map_err(|e| e.to_string())? {
    let scryfall_id: String = row.get(0).map_err(|e| e.to_string())?;
    let name: String = row.get(1).map_err(|e| e.to_string())?;
    let set_code: String = row.get(2).map_err(|e| e.to_string())?;
    let collector_number: String = row.get(3).map_err(|e| e.to_string())?;
    let image_url: String = row.get(4).map_err(|e| e.to_string())?;
    let market_price: f64 = row.get(5).map_err(|e| e.to_string())?;
    let updated_at: String = row.get(6).map_err(|e| e.to_string())?;

    let line = format!(
      "{}|{}|{}|{}|{}|{:.6}|{}\n",
      scryfall_id, name, set_code, collector_number, image_url, market_price, updated_at
    );
    hasher.update(line.as_bytes());
  }

  Ok(format!("{:x}", hasher.finalize()))
}

fn append_catalog_patch_history(
  connection: &Connection,
  dataset: &str,
  from_version: Option<&str>,
  to_version: &str,
  strategy: &str,
  patch_hash: Option<&str>,
  added_count: i64,
  updated_count: i64,
  removed_count: i64,
  total_records: i64,
) -> Result<(), String> {
  let now = now_iso();
  let patch_id = Uuid::new_v4().to_string();
  connection
    .execute(
      "INSERT INTO system_data_sync_patches (
         id, source_id, dataset_name, from_version, to_version, patch_hash,
         strategy, added_count, updated_count, removed_count, artifact_uri, created_at
       )
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11)",
      params![
        patch_id,
        SCRYFALL_SOURCE_ID,
        dataset,
        from_version,
        to_version,
        strategy,
        patch_hash,
        added_count,
        updated_count,
        removed_count,
        now
      ],
    )
    .map_err(|e| e.to_string())?;

  connection
    .execute(
      "INSERT INTO system_data_sync_patch_apply_history (
         id, client_id, dataset_name, from_version, to_version, strategy,
         duration_ms, result, error_message, applied_at
       )
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 'success', NULL, ?7)",
      params![
        Uuid::new_v4().to_string(),
        LOCAL_SYNC_CLIENT_ID,
        dataset,
        from_version,
        to_version,
        strategy,
        now
      ],
    )
    .map_err(|e| e.to_string())?;

  let _ = total_records;
  Ok(())
}

fn load_catalog_sync_state(connection: &Connection, dataset: &str) -> Result<CatalogSyncStateDto, String> {
  let (current_version, state_hash, synced_at) = read_catalog_sync_row(connection, dataset)?;
  let total_records = count_catalog_records(connection, dataset)?;
  Ok(CatalogSyncStateDto {
    dataset: dataset.to_string(),
    current_version,
    state_hash,
    synced_at,
    total_records,
  })
}

fn ensure_profile_exists(connection: &Connection, profile_id: &str) -> Result<(), String> {
  let profile_name: Option<String> = connection
    .query_row(
      "SELECT display_name
       FROM collection_data_profiles
       WHERE id = ?1
       LIMIT 1",
      params![profile_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  let Some(display_name) = profile_name else {
    return Err(format!("Profile not found: {}", profile_id));
  };

  let has_default_collection: Option<String> = connection
    .query_row(
      "SELECT id
       FROM collection_data_collections
       WHERE id = ?1
       LIMIT 1",
      params![profile_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  if has_default_collection.is_none() {
    let now = now_iso();
    let collection_name = if display_name.to_lowercase().contains("collection") {
      display_name
    } else {
      format!("{} Collection", display_name)
    };

    connection
      .execute(
        "INSERT INTO collection_data_collections
           (id, profile_id, name, description, visibility, created_at, updated_at)
         VALUES (?1, ?1, ?2, NULL, 'private', ?3, ?3)",
        params![profile_id, collection_name, now],
      )
      .map_err(|e| e.to_string())?;
  }

  Ok(())
}

fn ensure_card_and_printing(
  connection: &Connection,
  scryfall_id: &str,
  name: &str,
  set_code: &str,
  collector_number: &str,
  image_url: Option<&str>,
  type_line: Option<&str>,
  color_identity: Option<&[String]>,
  mana_value: Option<f64>,
  rarity: Option<&str>,
) -> Result<(), String> {
  let normalized_scryfall_id = scryfall_id.trim().to_lowercase();
  if normalized_scryfall_id.is_empty() {
    return Err("Cannot upsert card/printing with empty scryfall id.".to_string());
  }

  let now = now_iso();
  let normalized_set = {
    let candidate = set_code.trim().to_lowercase();
    if candidate.is_empty() {
      "unknown".to_string()
    } else {
      candidate
    }
  };
  let set_name = if normalized_set == "unknown" {
    "UNKNOWN".to_string()
  } else {
    normalized_set.to_uppercase()
  };
  let normalized_collector_number = {
    let candidate = collector_number.trim();
    if candidate.is_empty() {
      "0".to_string()
    } else {
      candidate.to_string()
    }
  };
  let normalized_type_line = type_line
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  let color_identity_json = color_identity
    .and_then(|values| {
      if values.is_empty() {
        None
      } else {
        Some(serde_json::to_string(values).unwrap_or_else(|_| "[]".to_string()))
      }
    });
  let normalized_rarity = rarity
    .map(|value| value.trim().to_lowercase())
    .filter(|value| !value.is_empty());

  connection
    .execute(
      "INSERT INTO card_data_sets (set_code, set_name, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(set_code) DO UPDATE SET
         set_name = excluded.set_name,
         updated_at = excluded.updated_at",
      params![normalized_set, set_name, now],
    )
    .map_err(|e| e.to_string())?;

  let existing_card_id: Option<String> = connection
    .query_row(
      "SELECT card_id
       FROM card_data_printings
       WHERE id = ?1
       LIMIT 1",
      params![normalized_scryfall_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?;
  let card_id = existing_card_id.unwrap_or_else(|| format!("scryfall:{}", normalized_scryfall_id));

  connection
    .execute(
      "INSERT INTO card_data_cards (
         id, oracle_id, name, mana_cost, cmc, type_line, oracle_text, reserved,
         keywords_json, colors_json, color_identity_json, latest_released_at, created_at, updated_at
       )
       VALUES (?1, NULL, ?2, NULL, ?3, ?4, NULL, 0, NULL, NULL, ?5, NULL, ?6, ?6)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         type_line = COALESCE(excluded.type_line, card_data_cards.type_line),
         color_identity_json = COALESCE(excluded.color_identity_json, card_data_cards.color_identity_json),
         cmc = COALESCE(excluded.cmc, card_data_cards.cmc),
         updated_at = excluded.updated_at",
      params![
        card_id,
        name.trim(),
        mana_value,
        normalized_type_line,
        color_identity_json,
        now
      ],
    )
    .map_err(|e| e.to_string())?;

  connection
    .execute(
      "INSERT INTO card_data_printings (
          id, card_id, oracle_id, set_code, collector_number, lang, rarity, layout, released_at, artist,
          image_normal_url, image_small_url, image_art_crop_url, image_png_url, is_token, is_digital,
          is_foil_available, is_nonfoil_available, tcgplayer_id, cardmarket_id, mtgo_id, mtgo_foil_id,
          created_at, updated_at
        )
        VALUES (?1, ?2, NULL, ?3, ?4, 'en', ?5, NULL, NULL, NULL, ?6, ?6, ?6, NULL, 0, 0, 1, 1, NULL, NULL, NULL, NULL, ?7, ?7)
        ON CONFLICT(id) DO UPDATE SET
          card_id = COALESCE(card_data_printings.card_id, excluded.card_id),
          set_code = CASE
            WHEN excluded.set_code = 'unknown' THEN card_data_printings.set_code
            ELSE excluded.set_code
          END,
          collector_number = CASE
            WHEN excluded.collector_number = '0' THEN card_data_printings.collector_number
            ELSE excluded.collector_number
          END,
          rarity = COALESCE(excluded.rarity, card_data_printings.rarity),
          image_normal_url = COALESCE(excluded.image_normal_url, card_data_printings.image_normal_url),
          image_small_url = COALESCE(excluded.image_small_url, card_data_printings.image_small_url),
          image_art_crop_url = COALESCE(excluded.image_art_crop_url, card_data_printings.image_art_crop_url),
          updated_at = excluded.updated_at",
      params![
        normalized_scryfall_id,
        card_id,
        normalized_set,
        normalized_collector_number,
        normalized_rarity,
        image_url,
        now
      ],
    )
    .map_err(|e| e.to_string())?;

  Ok(())
}

fn upsert_tags_for_owned_item(
  connection: &Connection,
  collection_id: &str,
  owned_item_id: &str,
  tags: &[String],
) -> Result<(), String> {
  connection
    .execute(
      "DELETE FROM collection_data_collection_item_tags WHERE collection_item_id = ?1",
      params![owned_item_id],
    )
    .map_err(|e| e.to_string())?;

  for tag in tags.iter().map(|tag| tag.trim()).filter(|tag| !tag.is_empty()) {
    let existing_tag_id: Option<String> = connection
      .query_row(
        "SELECT id
         FROM collection_data_tags
         WHERE collection_id = ?1
           AND lower(name) = lower(?2)
         LIMIT 1",
        params![collection_id, tag],
        |row| row.get(0),
      )
      .optional()
      .map_err(|e| e.to_string())?;

    let tag_id = if let Some(id) = existing_tag_id {
      id
    } else {
      let id = Uuid::new_v4().to_string();
      connection
        .execute(
          "INSERT INTO collection_data_tags (id, collection_id, name, color_hex, created_at)
           VALUES (?1, ?2, ?3, NULL, ?4)",
          params![id, collection_id, tag, now_iso()],
        )
        .map_err(|e| e.to_string())?;
      id
    };

    connection
      .execute(
        "INSERT OR IGNORE INTO collection_data_collection_item_tags (collection_item_id, tag_id, created_at)
         VALUES (?1, ?2, ?3)",
        params![owned_item_id, tag_id, now_iso()],
      )
      .map_err(|e| e.to_string())?;
  }

  Ok(())
}

fn load_tags_for_owned_item(connection: &Connection, owned_item_id: &str) -> Result<Vec<String>, String> {
  let mut statement = connection
    .prepare(
      "SELECT t.name
       FROM collection_data_collection_item_tags oit
       JOIN collection_data_tags t ON t.id = oit.tag_id
       WHERE oit.collection_item_id = ?1
       ORDER BY t.name COLLATE NOCASE",
    )
    .map_err(|e| e.to_string())?;

  let rows = statement
    .query_map(params![owned_item_id], |row| row.get::<usize, String>(0))
    .map_err(|e| e.to_string())?;

  let mut tags = Vec::new();
  for row in rows {
    tags.push(row.map_err(|e| e.to_string())?);
  }

  Ok(tags)
}

fn derive_tags(quantity: i64, foil_quantity: i64, existing: Vec<String>) -> Vec<String> {
  let mut tags = existing;
  let has_tag = |all: &[String], needle: &str| {
    all.iter().any(|tag| tag.eq_ignore_ascii_case(needle))
  };

  if foil_quantity > 0 && !has_tag(&tags, "foil") {
    tags.push("foil".to_string());
  }
  if quantity + foil_quantity >= 4 && !has_tag(&tags, "playset") {
    tags.push("playset".to_string());
  }
  if quantity + foil_quantity > 0 && !has_tag(&tags, "owned") {
    tags.push("owned".to_string());
  }

  tags.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
  tags.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
  tags
}

fn build_price_trend(connection: &Connection, scryfall_id: &str) -> Result<PriceTrend, String> {
  build_price_trend_by_column(connection, scryfall_id, "tcg_market")
}

fn price_column_from_source_key(source_id: &str) -> &'static str {
  match source_id.trim().to_lowercase().as_str() {
    "tcg-low" => "tcg_low",
    "tcg-mid" => "tcg_market",
    "tcg-high" => "tcg_high",
    "ck-sell" => "ck_sell",
    "ck-buylist" => "ck_buylist",
    _ => "tcg_market",
  }
}

fn build_price_trend_by_column(
  connection: &Connection,
  scryfall_id: &str,
  column: &str,
) -> Result<PriceTrend, String> {
  let sql = format!(
    "SELECT {col}, captured_at
     FROM card_data_card_prices
     WHERE printing_id = ?1
       AND {col} IS NOT NULL
     ORDER BY captured_at DESC
     LIMIT 2",
    col = column
  );
  let mut statement = connection
    .prepare(&sql)
    .map_err(|e| e.to_string())?;

  let mut rows = statement.query(params![scryfall_id]).map_err(|e| e.to_string())?;

  let mut prices: Vec<(f64, String)> = Vec::new();
  while let Some(row) = rows.next().map_err(|e| e.to_string())? {
    let price: f64 = row.get(0).map_err(|e| e.to_string())?;
    let captured_at: String = row.get(1).map_err(|e| e.to_string())?;
    prices.push((price, captured_at));
  }

  let current_price = prices.get(0).map(|entry| entry.0);
  let previous_price = prices.get(1).map(|entry| entry.0);
  let price_delta = match (current_price, previous_price) {
    (Some(current), Some(previous)) => Some(current - previous),
    _ => None,
  };

  let price_direction = match price_delta {
    Some(delta) if delta > 0.009 => "up".to_string(),
    Some(delta) if delta < -0.009 => "down".to_string(),
    Some(_) => "flat".to_string(),
    None => "none".to_string(),
  };

  Ok(PriceTrend {
    current_price,
    previous_price,
    price_delta,
    price_direction,
    last_price_at: prices.get(0).map(|entry| entry.1.clone()),
  })
}

fn load_collection_price_trends_by_source(
  connection: &Connection,
  profile_id: &str,
  source_id: &str,
) -> Result<Vec<MarketTrendDto>, String> {
  let price_column = price_column_from_source_key(source_id);
  let sql = format!(
    "SELECT DISTINCT
       ci.printing_id,
       (
         SELECT cp.{col}
         FROM card_data_card_prices cp
         WHERE cp.printing_id = ci.printing_id
           AND cp.{col} IS NOT NULL
         ORDER BY cp.captured_at DESC
         LIMIT 1
       ) AS current_price,
       (
         SELECT cp.{col}
         FROM card_data_card_prices cp
         WHERE cp.printing_id = ci.printing_id
           AND cp.{col} IS NOT NULL
         ORDER BY cp.captured_at DESC
         LIMIT 1 OFFSET 1
       ) AS previous_price,
       (
         SELECT cp.captured_at
         FROM card_data_card_prices cp
         WHERE cp.printing_id = ci.printing_id
           AND cp.{col} IS NOT NULL
         ORDER BY cp.captured_at DESC
         LIMIT 1
       ) AS last_price_at
     FROM collection_data_collection_items ci
     WHERE ci.collection_id = ?1
       AND (ci.quantity_nonfoil > 0 OR ci.quantity_foil > 0)",
    col = price_column
  );
  let mut statement = connection
    .prepare(&sql)
    .map_err(|e| e.to_string())?;

  let rows = statement
    .query_map(params![profile_id], |row| {
      Ok((
        row.get::<usize, String>(0)?,
        row.get::<usize, Option<f64>>(1)?,
        row.get::<usize, Option<f64>>(2)?,
        row.get::<usize, Option<String>>(3)?,
      ))
    })
    .map_err(|e| e.to_string())?;

  let mut out = Vec::new();
  for row in rows {
    let (scryfall_id, current_price, previous_price, last_price_at) =
      row.map_err(|e| e.to_string())?;
    let price_delta = match (current_price, previous_price) {
      (Some(current), Some(previous)) => Some(current - previous),
      _ => None,
    };
    let price_direction = match price_delta {
      Some(delta) if delta > 0.009 => "up".to_string(),
      Some(delta) if delta < -0.009 => "down".to_string(),
      Some(_) => "flat".to_string(),
      None => "none".to_string(),
    };

    out.push(MarketTrendDto {
      scryfall_id,
      current_price,
      previous_price,
      price_delta,
      price_direction,
      last_price_at,
    });
  }
  Ok(out)
}

fn maybe_insert_market_snapshot(
  connection: &Connection,
  scryfall_id: &str,
  market_price: f64,
  vendor: &str,
  channel: &str,
) -> Result<(), String> {
  if !market_price.is_finite() || market_price < 0.0 {
    return Ok(());
  }

  let normalized_vendor = vendor.trim().to_lowercase();
  let normalized_channel = channel.trim().to_lowercase();
  let (tcg_low, tcg_market, tcg_high, ck_sell, ck_buylist) =
    if normalized_vendor == "tcgplayer" {
      match normalized_channel.as_str() {
        "low" => (Some(market_price), None, None, None, None),
        "mid" => (None, Some(market_price), None, None, None),
        "high" => (None, None, Some(market_price), None, None),
        _ => (None, Some(market_price), None, None, None),
      }
    } else if normalized_vendor == "ck"
      || normalized_vendor == "card kingdom"
      || normalized_vendor == "cardkingdom"
    {
      if normalized_channel == "buy" || normalized_channel == "buylist" {
        (None, None, None, None, Some(market_price))
      } else {
        (None, None, None, Some(market_price), None)
      }
    } else {
      (None, Some(market_price), None, None, None)
    };

  let now = now_iso();
  let sync_version = sync_version_from_iso(&now);
  let captured_ymd = captured_ymd_from_iso(&now).unwrap_or_else(current_captured_ymd);
  upsert_compact_price_row(
    connection,
    scryfall_id,
    Some(CONDITION_NM_ID),
    Some(FINISH_NONFOIL_ID),
    tcg_low,
    tcg_market,
    tcg_high,
    ck_sell,
    ck_buylist,
    None,
    &sync_version,
    captured_ymd,
    &now,
  )?;

  Ok(())
}

fn upsert_compact_price_row(
  connection: &Connection,
  printing_id: &str,
  condition_id: Option<i64>,
  finish_id: Option<i64>,
  tcg_low: Option<f64>,
  tcg_market: Option<f64>,
  tcg_high: Option<f64>,
  ck_sell: Option<f64>,
  ck_buylist: Option<f64>,
  ck_buylist_quantity_cap: Option<i64>,
  sync_version: &str,
  captured_ymd: i64,
  captured_at: &str,
) -> Result<(), String> {
  let clean_price = |value: Option<f64>| -> Option<f64> {
    value.filter(|v| v.is_finite() && *v >= 0.0)
  };
  let tcg_low = clean_price(tcg_low);
  let tcg_market = clean_price(tcg_market);
  let tcg_high = clean_price(tcg_high);
  let ck_sell = clean_price(ck_sell);
  let ck_buylist = clean_price(ck_buylist);
  if tcg_low.is_none()
    && tcg_market.is_none()
    && tcg_high.is_none()
    && ck_sell.is_none()
    && ck_buylist.is_none()
    && ck_buylist_quantity_cap.is_none()
  {
    return Ok(());
  }

  connection
    .execute(
      "INSERT INTO card_data_card_prices (
         printing_id, condition_id, finish_id,
         tcg_low, tcg_market, tcg_high,
         ck_sell, ck_buylist, ck_buylist_quantity_cap,
         sync_version, captured_ymd, captured_at, created_at
       )
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
       ON CONFLICT(
         printing_id,
         IFNULL(condition_id, 0),
         IFNULL(finish_id, 0),
         sync_version
       ) DO UPDATE SET
         tcg_low = COALESCE(excluded.tcg_low, card_data_card_prices.tcg_low),
         tcg_market = COALESCE(excluded.tcg_market, card_data_card_prices.tcg_market),
         tcg_high = COALESCE(excluded.tcg_high, card_data_card_prices.tcg_high),
         ck_sell = COALESCE(excluded.ck_sell, card_data_card_prices.ck_sell),
         ck_buylist = COALESCE(excluded.ck_buylist, card_data_card_prices.ck_buylist),
         ck_buylist_quantity_cap = COALESCE(excluded.ck_buylist_quantity_cap, card_data_card_prices.ck_buylist_quantity_cap),
         captured_ymd = excluded.captured_ymd,
         captured_at = excluded.captured_at,
         created_at = excluded.created_at",
      params![
        printing_id,
        condition_id,
        finish_id,
        tcg_low,
        tcg_market,
        tcg_high,
        ck_sell,
        ck_buylist,
        ck_buylist_quantity_cap,
        sync_version,
        captured_ymd,
        captured_at
      ],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

fn parse_ck_bool(value: Option<&str>) -> bool {
  matches!(
    value.unwrap_or_default().trim().to_lowercase().as_str(),
    "true" | "1" | "yes" | "y"
  )
}

fn parse_ck_price(value: Option<&str>) -> f64 {
  let text = value.unwrap_or_default().trim().replace('$', "");
  text.parse::<f64>().unwrap_or(0.0)
}

fn ck_cache_path(state: &AppState) -> PathBuf {
  state.app_data_dir.join(CK_PRICELIST_CACHE_FILE)
}

fn is_ck_cache_fresh(path: &PathBuf) -> bool {
  if !path.exists() {
    return false;
  }
  let Ok(metadata) = fs::metadata(path) else {
    return false;
  };
  let Ok(modified) = metadata.modified() else {
    return false;
  };
  let Ok(age) = SystemTime::now().duration_since(modified) else {
    return false;
  };
  age.as_secs() <= CK_PRICELIST_CACHE_MAX_AGE_SECONDS
}

fn fetch_ck_pricelist_body() -> Result<String, String> {
  let client = Client::builder()
    .timeout(Duration::from_secs(60))
    .build()
    .map_err(|e| e.to_string())?;

  let response = client
    .get(CK_PRICELIST_URL)
    .header(
      USER_AGENT,
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    )
    .header(ACCEPT, "application/json,text/plain,*/*")
    .header(ACCEPT_LANGUAGE, "en-US,en;q=0.9")
    .header(CONNECTION, "close")
    .header(REFERER, "https://www.cardkingdom.com/")
    .send()
    .map_err(|e| e.to_string())?;

  if !response.status().is_success() {
    return Err(format!(
      "Card Kingdom buylist request failed with status {}",
      response.status()
    ));
  }

  response.text().map_err(|e| e.to_string())
}

fn load_ck_pricelist_items(state: &AppState) -> Result<Vec<CkPricelistItem>, String> {
  let cache_path = ck_cache_path(state);
  let body = if is_ck_cache_fresh(&cache_path) {
    fs::read_to_string(&cache_path).map_err(|e| e.to_string())?
  } else {
    let downloaded = fetch_ck_pricelist_body()?;
    fs::write(&cache_path, &downloaded).map_err(|e| e.to_string())?;
    downloaded
  };

  if let Ok(parsed) = serde_json::from_str::<CkPricelistPayload>(&body) {
    return Ok(parsed.data);
  }
  if let Ok(parsed) = serde_json::from_str::<Vec<CkPricelistItem>>(&body) {
    return Ok(parsed);
  }
  Err("Unable to parse Card Kingdom buylist payload.".to_string())
}

fn fetch_tcgtracking_set_list() -> Result<Vec<TcgTrackingSetListItem>, String> {
  let client = Client::builder()
    .timeout(Duration::from_secs(45))
    .build()
    .map_err(|e| e.to_string())?;
  let response = client
    .get("https://tcgtracking.com/tcgapi/v1/1/sets")
    .header(
      USER_AGENT,
      "MagicCollectionDesktop/1.0 (+https://github.com/joemoffett1/Space-Dog)",
    )
    .header(ACCEPT, "application/json")
    .send()
    .map_err(|e| e.to_string())?;
  if !response.status().is_success() {
    return Err(format!(
      "TCGTracking set list failed with status {}",
      response.status()
    ));
  }
  let payload: TcgTrackingSetListResponse = response.json().map_err(|e| e.to_string())?;
  Ok(payload.sets)
}

fn fetch_tcgtracking_set_products(set_id: i64) -> Result<TcgTrackingSetProductsResponse, String> {
  let client = Client::builder()
    .timeout(Duration::from_secs(45))
    .build()
    .map_err(|e| e.to_string())?;
  let response = client
    .get(format!("https://tcgtracking.com/tcgapi/v1/1/sets/{}", set_id))
    .header(
      USER_AGENT,
      "MagicCollectionDesktop/1.0 (+https://github.com/joemoffett1/Space-Dog)",
    )
    .header(ACCEPT, "application/json")
    .send()
    .map_err(|e| e.to_string())?;
  if !response.status().is_success() {
    return Err(format!(
      "TCGTracking set products failed for {} with status {}",
      set_id,
      response.status()
    ));
  }
  response.json().map_err(|e| e.to_string())
}

fn fetch_tcgtracking_set_pricing(set_id: i64) -> Result<TcgTrackingSetPricingResponse, String> {
  let client = Client::builder()
    .timeout(Duration::from_secs(45))
    .build()
    .map_err(|e| e.to_string())?;
  let response = client
    .get(format!(
      "https://tcgtracking.com/tcgapi/v1/1/sets/{}/pricing",
      set_id
    ))
    .header(
      USER_AGENT,
      "MagicCollectionDesktop/1.0 (+https://github.com/joemoffett1/Space-Dog)",
    )
    .header(ACCEPT, "application/json")
    .send()
    .map_err(|e| e.to_string())?;
  if !response.status().is_success() {
    return Err(format!(
      "TCGTracking pricing failed for {} with status {}",
      set_id,
      response.status()
    ));
  }
  response.json().map_err(|e| e.to_string())
}

fn fetch_tcgtracking_set_skus(set_id: i64) -> Result<TcgTrackingSetSkusResponse, String> {
  let client = Client::builder()
    .timeout(Duration::from_secs(60))
    .build()
    .map_err(|e| e.to_string())?;
  let response = client
    .get(format!(
      "https://tcgtracking.com/tcgapi/v1/1/sets/{}/skus",
      set_id
    ))
    .header(
      USER_AGENT,
      "MagicCollectionDesktop/1.0 (+https://github.com/joemoffett1/Space-Dog)",
    )
    .header(ACCEPT, "application/json")
    .send()
    .map_err(|e| e.to_string())?;
  if !response.status().is_success() {
    return Err(format!(
      "TCGTracking skus failed for {} with status {}",
      set_id,
      response.status()
    ));
  }
  response.json().map_err(|e| e.to_string())
}

fn list_missing_metadata_scryfall_ids(
  connection: &Connection,
  profile_id: &str,
  limit: i64,
) -> Result<Vec<String>, String> {
  let mut statement = connection
    .prepare(
      "SELECT DISTINCT ci.printing_id
       FROM collection_data_collection_items ci
       JOIN card_data_printings p ON p.id = ci.printing_id
       JOIN card_data_cards c ON c.id = p.card_id
       WHERE ci.collection_id = ?1
         AND (ci.quantity_nonfoil > 0 OR ci.quantity_foil > 0)
         AND (
           c.type_line IS NULL OR trim(c.type_line) = ''
           OR c.color_identity_json IS NULL
           OR c.cmc IS NULL
           OR p.rarity IS NULL OR trim(p.rarity) = ''
         )
       LIMIT ?2",
    )
    .map_err(|e| e.to_string())?;

  let rows = statement
    .query_map(params![profile_id, limit], |row| row.get::<usize, String>(0))
    .map_err(|e| e.to_string())?;

  let mut ids = Vec::new();
  for row in rows {
    ids.push(row.map_err(|e| e.to_string())?);
  }
  Ok(ids)
}

fn count_missing_metadata_rows(connection: &Connection, profile_id: &str) -> Result<i64, String> {
  connection
    .query_row(
      "SELECT count(*)
       FROM collection_data_collection_items ci
       JOIN card_data_printings p ON p.id = ci.printing_id
       JOIN card_data_cards c ON c.id = p.card_id
       WHERE ci.collection_id = ?1
         AND (ci.quantity_nonfoil > 0 OR ci.quantity_foil > 0)
         AND (
           c.type_line IS NULL OR trim(c.type_line) = ''
           OR c.color_identity_json IS NULL
           OR c.cmc IS NULL
           OR p.rarity IS NULL OR trim(p.rarity) = ''
         )",
      params![profile_id],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn fetch_scryfall_collection_cards(ids: &[String]) -> Result<Vec<ScryfallCollectionCard>, String> {
  if ids.is_empty() {
    return Ok(Vec::new());
  }

  let client = Client::builder()
    .timeout(Duration::from_secs(30))
    .build()
    .map_err(|e| e.to_string())?;

  let payload = ScryfallCollectionRequest {
    identifiers: ids
      .iter()
      .map(|id| ScryfallCollectionIdentifier { id: id.clone() })
      .collect(),
  };

  let response = client
    .post("https://api.scryfall.com/cards/collection")
    .header(
      USER_AGENT,
      "MagicCollectionDesktop/1.0 (+https://github.com/joemoffett1/Space-Dog)",
    )
    .header(ACCEPT, "application/json")
    .header(ACCEPT_LANGUAGE, "en-US,en;q=0.9")
    .json(&payload)
    .send()
    .map_err(|e| e.to_string())?;

  if !response.status().is_success() {
    return Err(format!(
      "Scryfall metadata request failed with status {}",
      response.status()
    ));
  }

  let body: ScryfallCollectionResponse = response.json().map_err(|e| e.to_string())?;
  Ok(body.data)
}

fn fetch_scryfall_default_cards_bulk() -> Result<Vec<ScryfallCollectionCard>, String> {
  let client = Client::builder()
    .timeout(Duration::from_secs(60 * 20))
    .build()
    .map_err(|e| e.to_string())?;

  let bulk_response = client
    .get("https://api.scryfall.com/bulk-data")
    .header(
      USER_AGENT,
      "MagicCollectionDesktop/1.0 (+https://github.com/joemoffett1/Space-Dog)",
    )
    .header(ACCEPT, "application/json")
    .send()
    .map_err(|e| e.to_string())?;

  if !bulk_response.status().is_success() {
    return Err(format!(
      "Scryfall bulk-data index failed with status {}",
      bulk_response.status()
    ));
  }

  let bulk_payload: ScryfallBulkDataListResponse =
    bulk_response.json().map_err(|e| e.to_string())?;
  let download_uri = bulk_payload
    .data
    .iter()
    .find(|item| item.bulk_type == "default_cards")
    .and_then(|item| item.download_uri.clone())
    .ok_or_else(|| "Unable to find default_cards download URI in Scryfall bulk-data.".to_string())?;

  let cards_response = client
    .get(download_uri)
    .header(
      USER_AGENT,
      "MagicCollectionDesktop/1.0 (+https://github.com/joemoffett1/Space-Dog)",
    )
    .header(ACCEPT, "application/json")
    .send()
    .map_err(|e| e.to_string())?;
  if !cards_response.status().is_success() {
    return Err(format!(
      "Scryfall default_cards download failed with status {}",
      cards_response.status()
    ));
  }

  cards_response.json().map_err(|e| e.to_string())
}

fn ensure_sync_source(
  connection: &Connection,
  source_id: &str,
  kind: &str,
  base_url: &str,
  refresh_window_utc: Option<&str>,
) -> Result<(), String> {
  connection
    .execute(
      "INSERT INTO system_data_sync_data_sources (id, kind, base_url, enabled, refresh_window_utc, updated_at)
       VALUES (?1, ?2, ?3, 1, ?4, ?5)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         base_url = excluded.base_url,
         enabled = 1,
         refresh_window_utc = excluded.refresh_window_utc,
         updated_at = excluded.updated_at",
      params![source_id, kind, base_url, refresh_window_utc, now_iso()],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

fn write_source_sync_record(
  connection: &Connection,
  source_id: &str,
  dataset_name: &str,
  build_version: &str,
  record_count: i64,
  state_hash: Option<&str>,
) -> Result<(), String> {
  let now = now_iso();
  let row_id = format!("{}:{}:{}", source_id, dataset_name, build_version);
  connection
    .execute(
      "INSERT INTO system_data_sync_dataset_versions
         (id, source_id, dataset_name, build_version, state_hash, record_count, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET
         state_hash = excluded.state_hash,
         record_count = excluded.record_count,
         created_at = excluded.created_at",
      params![
        row_id,
        source_id,
        dataset_name,
        build_version,
        state_hash,
        record_count,
        now
      ],
    )
    .map_err(|e| e.to_string())?;

  connection
    .execute(
      "INSERT INTO system_data_sync_client_sync_state
         (client_id, dataset_name, current_version, state_hash, synced_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(client_id, dataset_name) DO UPDATE SET
         current_version = excluded.current_version,
         state_hash = excluded.state_hash,
         synced_at = excluded.synced_at,
         updated_at = excluded.updated_at",
      params![LOCAL_SYNC_CLIENT_ID, dataset_name, build_version, state_hash, now],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

fn upsert_scryfall_oracle_if_changed(
  connection: &Connection,
  card: &ScryfallCollectionCard,
) -> Result<bool, String> {
  let scryfall_id = card.id.trim().to_lowercase();
  if scryfall_id.is_empty() {
    return Ok(false);
  }

  let now = now_iso();
  let set_code = card
    .set
    .as_deref()
    .unwrap_or("unknown")
    .trim()
    .to_lowercase();
  let set_name = card
    .set_name
    .as_deref()
    .map(|value| value.trim())
    .filter(|value| !value.is_empty())
    .unwrap_or("UNKNOWN");
  let name = card
    .name
    .as_deref()
    .map(|value| value.trim())
    .filter(|value| !value.is_empty())
    .unwrap_or("Unknown Card")
    .to_string();
  let collector_number = card
    .collector_number
    .as_deref()
    .map(|value| value.trim())
    .filter(|value| !value.is_empty())
    .unwrap_or("0")
    .to_string();
  let lang = card
    .lang
    .as_deref()
    .map(|value| value.trim().to_lowercase())
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| "en".to_string());
  let rarity = card
    .rarity
    .as_deref()
    .map(|value| value.trim().to_lowercase())
    .filter(|value| !value.is_empty());
  let mana_cost = card
    .mana_cost
    .as_deref()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  let type_line = card
    .type_line
    .as_deref()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  let oracle_text = card
    .oracle_text
    .as_deref()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  let colors_json = card
    .colors
    .as_ref()
    .map(|value| serde_json::to_string(value).unwrap_or_else(|_| "[]".to_string()));
  let color_identity_json = card
    .color_identity
    .as_ref()
    .map(|value| serde_json::to_string(value).unwrap_or_else(|_| "[]".to_string()));
  let keywords_json = card
    .keywords
    .as_ref()
    .map(|value| serde_json::to_string(value).unwrap_or_else(|_| "[]".to_string()));
  let cmc = card.cmc.filter(|value| value.is_finite() && *value >= 0.0);
  let released_at = card
    .released_at
    .as_deref()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  let layout = card
    .layout
    .as_deref()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  let artist = card
    .artist
    .as_deref()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  let is_digital = card.digital.unwrap_or(false);
  let finishes = card.finishes.clone().unwrap_or_default();
  let is_foil_available = finishes.iter().any(|value| value.eq_ignore_ascii_case("foil"));
  let is_nonfoil_available = finishes
    .iter()
    .any(|value| value.eq_ignore_ascii_case("nonfoil"));
  let normal_image = card
    .image_uris
    .as_ref()
    .and_then(|uris| uris.normal.clone())
    .or_else(|| {
      card
        .card_faces
        .as_ref()
        .and_then(|faces| faces.first())
        .and_then(|face| face.image_uris.as_ref())
        .and_then(|uris| uris.normal.clone())
    });
  let small_image = card
    .image_uris
    .as_ref()
    .and_then(|uris| uris.small.clone())
    .or_else(|| {
      card
        .card_faces
        .as_ref()
        .and_then(|faces| faces.first())
        .and_then(|face| face.image_uris.as_ref())
        .and_then(|uris| uris.small.clone())
    });
  let art_crop_image = card
    .image_uris
    .as_ref()
    .and_then(|uris| uris.art_crop.clone())
    .or_else(|| {
      card
        .card_faces
        .as_ref()
        .and_then(|faces| faces.first())
        .and_then(|face| face.image_uris.as_ref())
        .and_then(|uris| uris.art_crop.clone())
    });

  connection
    .execute(
      "INSERT INTO card_data_sets (set_code, set_name, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(set_code) DO UPDATE SET
         set_name = excluded.set_name,
         updated_at = excluded.updated_at",
      params![set_code, set_name, now],
    )
    .map_err(|e| e.to_string())?;

  let existing_card_id: Option<String> = connection
    .query_row(
      "SELECT card_id FROM card_data_printings WHERE id = ?1 LIMIT 1",
      params![scryfall_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?;
  let was_existing_printing = existing_card_id.is_some();
  let card_id = existing_card_id.unwrap_or_else(|| format!("scryfall:{}", scryfall_id));

  connection
    .execute(
      "INSERT INTO card_data_cards (
         id, oracle_id, name, mana_cost, cmc, type_line, oracle_text, reserved,
         keywords_json, colors_json, color_identity_json, latest_released_at, created_at, updated_at
       )
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
       ON CONFLICT(id) DO NOTHING",
      params![
        card_id,
        card.oracle_id,
        name,
        mana_cost,
        cmc,
        type_line,
        oracle_text,
        if card.reserved.unwrap_or(false) { 1 } else { 0 },
        keywords_json,
        colors_json,
        color_identity_json,
        released_at,
        now
      ],
    )
    .map_err(|e| e.to_string())?;

  connection
    .execute(
      "INSERT INTO card_data_printings (
          id, card_id, oracle_id, set_code, collector_number, lang, rarity, layout, released_at, artist,
          image_normal_url, image_small_url, image_art_crop_url, image_png_url, is_token, is_digital,
          is_foil_available, is_nonfoil_available, tcgplayer_id, cardmarket_id, mtgo_id, mtgo_foil_id,
          created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL, 0, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?21)
        ON CONFLICT(id) DO NOTHING",
      params![
        scryfall_id,
        card_id,
        card.oracle_id,
        set_code,
        collector_number,
        lang,
        rarity,
        layout,
        released_at,
        artist,
        normal_image,
        small_image,
        art_crop_image,
        if is_digital { 1 } else { 0 },
        if is_foil_available { 1 } else { 0 },
        if is_nonfoil_available { 1 } else { 0 },
        card.tcgplayer_id,
        card.cardmarket_id,
        card.mtgo_id,
        card.mtgo_foil_id,
        now
      ],
    )
    .map_err(|e| e.to_string())?;

  let before = connection
    .query_row(
      "SELECT
         COALESCE(c.name, ''),
         COALESCE(c.mana_cost, ''),
         COALESCE(c.type_line, ''),
         COALESCE(c.oracle_text, ''),
         COALESCE(c.cmc, -1),
         COALESCE(c.reserved, 0),
         COALESCE(c.keywords_json, ''),
         COALESCE(c.colors_json, ''),
         COALESCE(c.color_identity_json, ''),
         COALESCE(c.latest_released_at, ''),
         COALESCE(p.set_code, ''),
         COALESCE(p.collector_number, ''),
         COALESCE(p.lang, ''),
         COALESCE(p.rarity, ''),
         COALESCE(p.layout, ''),
         COALESCE(p.released_at, ''),
         COALESCE(p.artist, ''),
         COALESCE(p.image_normal_url, ''),
         COALESCE(p.image_small_url, ''),
         COALESCE(p.image_art_crop_url, ''),
         COALESCE(p.is_digital, 0),
         COALESCE(p.is_foil_available, 0),
         COALESCE(p.is_nonfoil_available, 0),
         COALESCE(p.tcgplayer_id, -1),
         COALESCE(p.cardmarket_id, -1),
         COALESCE(p.mtgo_id, -1),
         COALESCE(p.mtgo_foil_id, -1)
       FROM card_data_printings p
       JOIN card_data_cards c ON c.id = p.card_id
       WHERE p.id = ?1
       LIMIT 1",
      params![scryfall_id],
      |row| {
        Ok((
          row.get::<usize, String>(0)?,
          row.get::<usize, String>(1)?,
          row.get::<usize, String>(2)?,
          row.get::<usize, String>(3)?,
          row.get::<usize, f64>(4)?,
          row.get::<usize, i64>(5)?,
          row.get::<usize, String>(6)?,
          row.get::<usize, String>(7)?,
          row.get::<usize, String>(8)?,
          row.get::<usize, String>(9)?,
          row.get::<usize, String>(10)?,
          row.get::<usize, String>(11)?,
          row.get::<usize, String>(12)?,
          row.get::<usize, String>(13)?,
          row.get::<usize, String>(14)?,
          row.get::<usize, String>(15)?,
          row.get::<usize, String>(16)?,
          row.get::<usize, String>(17)?,
          row.get::<usize, String>(18)?,
          row.get::<usize, String>(19)?,
          row.get::<usize, i64>(20)?,
          row.get::<usize, i64>(21)?,
          row.get::<usize, i64>(22)?,
          row.get::<usize, i64>(23)?,
          row.get::<usize, i64>(24)?,
          row.get::<usize, i64>(25)?,
          row.get::<usize, i64>(26)?,
        ))
      },
    )
    .optional()
    .map_err(|e| e.to_string())?;

  let Some(current) = before else {
    return Ok(false);
  };

  let current_tuple = current;
  let next_tuple: (
    String,
    String,
    String,
    String,
    f64,
    i64,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    i64,
    i64,
    i64,
    i64,
    i64,
    i64,
    i64,
  ) = (
    name,
    mana_cost.clone().unwrap_or_default(),
    type_line.clone().unwrap_or_default(),
    oracle_text.clone().unwrap_or_default(),
    cmc.unwrap_or(-1.0),
    if card.reserved.unwrap_or(false) { 1_i64 } else { 0_i64 },
    keywords_json.unwrap_or_default(),
    colors_json.unwrap_or_default(),
    color_identity_json.unwrap_or_default(),
    released_at.clone().unwrap_or_default(),
    set_code.clone(),
    collector_number,
    lang,
    rarity.clone().unwrap_or_default(),
    layout.clone().unwrap_or_default(),
    released_at.unwrap_or_default(),
    artist.clone().unwrap_or_default(),
    normal_image.clone().unwrap_or_default(),
    small_image.clone().unwrap_or_default(),
    art_crop_image.clone().unwrap_or_default(),
    if is_digital { 1_i64 } else { 0_i64 },
    if is_foil_available { 1_i64 } else { 0_i64 },
    if is_nonfoil_available { 1_i64 } else { 0_i64 },
    card.tcgplayer_id.unwrap_or(-1_i64),
    card.cardmarket_id.unwrap_or(-1_i64),
    card.mtgo_id.unwrap_or(-1_i64),
    card.mtgo_foil_id.unwrap_or(-1_i64),
  );

  let current_signature = serde_json::json!([
    current_tuple.0,
    current_tuple.1,
    current_tuple.2,
    current_tuple.3,
    current_tuple.4,
    current_tuple.5,
    current_tuple.6,
    current_tuple.7,
    current_tuple.8,
    current_tuple.9,
    current_tuple.10,
    current_tuple.11,
    current_tuple.12,
    current_tuple.13,
    current_tuple.14,
    current_tuple.15,
    current_tuple.16,
    current_tuple.17,
    current_tuple.18,
    current_tuple.19,
    current_tuple.20,
    current_tuple.21,
    current_tuple.22,
    current_tuple.23,
    current_tuple.24,
    current_tuple.25,
    current_tuple.26
  ]);
  let next_signature = serde_json::json!([
    next_tuple.0,
    next_tuple.1,
    next_tuple.2,
    next_tuple.3,
    next_tuple.4,
    next_tuple.5,
    next_tuple.6,
    next_tuple.7,
    next_tuple.8,
    next_tuple.9,
    next_tuple.10,
    next_tuple.11,
    next_tuple.12,
    next_tuple.13,
    next_tuple.14,
    next_tuple.15,
    next_tuple.16,
    next_tuple.17,
    next_tuple.18,
    next_tuple.19,
    next_tuple.20,
    next_tuple.21,
    next_tuple.22,
    next_tuple.23,
    next_tuple.24,
    next_tuple.25,
    next_tuple.26
  ]);
  if current_signature == next_signature {
    return Ok(!was_existing_printing);
  }

  connection
    .execute(
      "UPDATE card_data_cards
       SET oracle_id = ?1,
           name = ?2,
           mana_cost = ?3,
           cmc = ?4,
           type_line = ?5,
           oracle_text = ?6,
           reserved = ?7,
           keywords_json = ?8,
           colors_json = ?9,
           color_identity_json = ?10,
           latest_released_at = ?11,
           updated_at = ?12
       WHERE id = ?13",
      params![
        card.oracle_id,
        next_tuple.0,
        mana_cost,
        cmc,
        type_line,
        oracle_text,
        next_tuple.5,
        if next_tuple.6.is_empty() { None::<String> } else { Some(next_tuple.6.clone()) },
        if next_tuple.7.is_empty() { None::<String> } else { Some(next_tuple.7.clone()) },
        if next_tuple.8.is_empty() { None::<String> } else { Some(next_tuple.8.clone()) },
        if next_tuple.9.is_empty() { None::<String> } else { Some(next_tuple.9.clone()) },
        now,
        card_id
      ],
    )
    .map_err(|e| e.to_string())?;

  connection
    .execute(
      "UPDATE card_data_printings
       SET oracle_id = ?1,
           set_code = ?2,
           collector_number = ?3,
           lang = ?4,
           rarity = ?5,
           layout = ?6,
           released_at = ?7,
           artist = ?8,
           image_normal_url = ?9,
           image_small_url = ?10,
           image_art_crop_url = ?11,
           is_digital = ?12,
           is_foil_available = ?13,
           is_nonfoil_available = ?14,
           tcgplayer_id = ?15,
           cardmarket_id = ?16,
           mtgo_id = ?17,
           mtgo_foil_id = ?18,
           updated_at = ?19
       WHERE id = ?20",
      params![
        card.oracle_id,
        set_code,
        next_tuple.11,
        next_tuple.12,
        rarity,
        layout,
        if next_tuple.15.is_empty() { None::<String> } else { Some(next_tuple.15) },
        artist,
        normal_image,
        small_image,
        art_crop_image,
        next_tuple.20,
        next_tuple.21,
        next_tuple.22,
        card.tcgplayer_id,
        card.cardmarket_id,
        card.mtgo_id,
        card.mtgo_foil_id,
        now,
        scryfall_id
      ],
    )
    .map_err(|e| e.to_string())?;

  Ok(true)
}

fn hydrate_printing_metadata_batch(
  connection: &Connection,
  cards: &[ScryfallCollectionCard],
) -> Result<i64, String> {
  if cards.is_empty() {
    return Ok(0);
  }

  let mut hydrated = 0_i64;
  let now = now_iso();

  for card in cards {
    let scryfall_id = card.id.trim();
    if scryfall_id.is_empty() {
      continue;
    }

    let normalized_type_line = card
      .type_line
      .as_ref()
      .map(|value| value.trim().to_string())
      .filter(|value| !value.is_empty());

    let color_identity_json = card
      .color_identity
      .as_ref()
      .map(|values| serde_json::to_string(values).unwrap_or_else(|_| "[]".to_string()));

    let cmc = card.cmc.filter(|value| value.is_finite() && *value >= 0.0);
    let rarity = card
      .rarity
      .as_ref()
      .map(|value| value.trim().to_lowercase())
      .filter(|value| !value.is_empty());

    let normal_image = card
      .image_uris
      .as_ref()
      .and_then(|uris| uris.normal.clone())
      .or_else(|| {
        card
          .card_faces
          .as_ref()
          .and_then(|faces| faces.first())
          .and_then(|face| face.image_uris.as_ref())
          .and_then(|uris| uris.normal.clone())
      });
    let small_image = card
      .image_uris
      .as_ref()
      .and_then(|uris| uris.small.clone())
      .or_else(|| {
        card
          .card_faces
          .as_ref()
          .and_then(|faces| faces.first())
          .and_then(|face| face.image_uris.as_ref())
          .and_then(|uris| uris.small.clone())
      });
    let art_crop_image = card
      .image_uris
      .as_ref()
      .and_then(|uris| uris.art_crop.clone())
      .or_else(|| {
        card
          .card_faces
          .as_ref()
          .and_then(|faces| faces.first())
          .and_then(|face| face.image_uris.as_ref())
          .and_then(|uris| uris.art_crop.clone())
      });

    connection
      .execute(
        "UPDATE card_data_cards
         SET type_line = COALESCE(?1, type_line),
             color_identity_json = COALESCE(?2, color_identity_json),
             cmc = COALESCE(?3, cmc),
             updated_at = ?4
         WHERE id = (SELECT card_id FROM card_data_printings WHERE id = ?5 LIMIT 1)",
        params![normalized_type_line, color_identity_json, cmc, now, scryfall_id],
      )
      .map_err(|e| e.to_string())?;

    connection
      .execute(
        "UPDATE card_data_printings
         SET rarity = COALESCE(?1, rarity),
             image_normal_url = COALESCE(?2, image_normal_url),
             image_small_url = COALESCE(?3, image_small_url),
             image_art_crop_url = COALESCE(?4, image_art_crop_url),
             updated_at = ?5
         WHERE id = ?6",
        params![
          rarity,
          normal_image,
          small_image,
          art_crop_image,
          now,
          scryfall_id
        ],
      )
      .map_err(|e| e.to_string())?;

    hydrated += 1;
  }

  Ok(hydrated)
}

fn make_ck_source_url(raw: Option<&str>) -> String {
  let path = raw.unwrap_or_default().trim().trim_start_matches('/');
  if path.is_empty() {
    return "https://www.cardkingdom.com/".to_string();
  }
  format!("https://www.cardkingdom.com/{}", path)
}

fn parse_color_identity_json(raw: Option<String>) -> Vec<String> {
  let Some(value) = raw else {
    return Vec::new();
  };
  if value.trim().is_empty() {
    return Vec::new();
  }
  serde_json::from_str::<Vec<String>>(&value).unwrap_or_default()
}

fn push_filter_token(
  bucket: &mut std::collections::BTreeMap<String, FilterTokenDto>,
  token: &str,
  label: &str,
  kind: &str,
  source: &str,
  priority: i64,
) {
  let normalized_token = token.trim().to_lowercase();
  if normalized_token.is_empty() {
    return;
  }
  let normalized_label = label.trim().to_string();
  if normalized_label.is_empty() {
    return;
  }
  let normalized_kind = kind.trim().to_lowercase();
  let normalized_source = source.trim().to_lowercase();
  let key = format!("{}:{}", normalized_kind, normalized_token);
  bucket.insert(
    key,
    FilterTokenDto {
      token: normalized_token,
      label: normalized_label,
      kind: normalized_kind,
      source: normalized_source,
      priority,
    },
  );
}

fn extract_primary_type(type_line: Option<&str>) -> Option<String> {
  let text = type_line?.trim();
  if text.is_empty() {
    return None;
  }
  let left = text.split('—').next().unwrap_or(text).trim().to_lowercase();
  if left.is_empty() {
    return None;
  }
  let known = [
    "artifact",
    "battle",
    "creature",
    "enchantment",
    "instant",
    "land",
    "planeswalker",
    "sorcery",
    "tribal",
  ];
  for value in known {
    if left.contains(value) {
      return Some(value.to_string());
    }
  }
  Some(
    left
      .split_whitespace()
      .next()
      .unwrap_or("unknown")
      .to_string(),
  )
}

fn normalize_color_symbols(colors: &[String]) -> Option<String> {
  if colors.is_empty() {
    return Some("c".to_string());
  }
  let mut out = String::new();
  for symbol in ["W", "U", "B", "R", "G"] {
    if colors.iter().any(|value| value.eq_ignore_ascii_case(symbol)) {
      out.push_str(&symbol.to_lowercase());
    }
  }
  if out.is_empty() {
    Some("c".to_string())
  } else {
    Some(out)
  }
}

fn collect_filter_tokens(
  connection: &Connection,
  collection_id: Option<&str>,
) -> Result<Vec<FilterTokenDto>, String> {
  let mut bucket: std::collections::BTreeMap<String, FilterTokenDto> =
    std::collections::BTreeMap::new();

  let defaults: [(&str, &str, &str, i64); 20] = [
    ("set:", "Set code (example: set:neo)", "syntax", 1),
    ("t:", "Type line (example: t:creature)", "syntax", 2),
    ("type:", "Type line (example: type:instant)", "syntax", 3),
    ("tag:", "Internal tag (example: tag:not_for_sale)", "syntax", 4),
    ("c:", "Color identity contains (example: c:uw)", "syntax", 5),
    ("id:", "Color identity strict-ish (example: id:g)", "syntax", 6),
    ("rarity:", "Rarity (example: rarity:rare)", "syntax", 7),
    ("mv:", "Mana value exact (example: mv:3)", "syntax", 8),
    ("mv>=", "Mana value compare (example: mv>=4)", "syntax", 9),
    ("mv<=", "Mana value compare (example: mv<=2)", "syntax", 10),
    ("name:", "Card name contains text", "syntax", 11),
    ("lang:", "Language (example: lang:en)", "syntax", 12),
    ("cond:", "Condition (example: cond:nm)", "syntax", 13),
    ("is:foil", "Cards with foil copies", "syntax", 14),
    ("is:nonfoil", "Cards with nonfoil copies", "syntax", 15),
    ("is:playset", "Cards with 4+ total copies", "syntax", 16),
    ("sort:name", "Sort by name", "syntax", 17),
    ("sort:qty", "Sort by total quantity", "syntax", 18),
    ("sort:price", "Sort by market price", "syntax", 19),
    ("sort:trend", "Sort by price trend", "syntax", 20),
  ];
  for (token, label, kind, priority) in defaults {
    push_filter_token(&mut bucket, token, label, kind, "seed", priority);
  }

  let mut set_stmt = connection
    .prepare(
      "SELECT DISTINCT lower(p.set_code)
       FROM collection_data_collection_items ci
       JOIN card_data_printings p ON p.id = ci.printing_id
       WHERE (?1 IS NULL OR ci.collection_id = ?1)
         AND (ci.quantity_nonfoil > 0 OR ci.quantity_foil > 0)",
    )
    .map_err(|e| e.to_string())?;
  let set_rows = set_stmt
    .query_map(params![collection_id], |row| row.get::<usize, String>(0))
    .map_err(|e| e.to_string())?;
  for row in set_rows {
    let code = row.map_err(|e| e.to_string())?;
    if code.trim().is_empty() {
      continue;
    }
    push_filter_token(
      &mut bucket,
      &format!("set:{}", code),
      &format!("Set {}", code.to_uppercase()),
      "set",
      "derived",
      50,
    );
  }

  let mut tag_stmt = connection
    .prepare(
      "SELECT DISTINCT lower(t.name), t.name
       FROM collection_data_tags t
       WHERE (?1 IS NULL OR t.collection_id = ?1)
         AND lower(t.name) NOT IN ('owned', 'foil', 'playset')
       ORDER BY t.name COLLATE NOCASE",
    )
    .map_err(|e| e.to_string())?;
  let tag_rows = tag_stmt
    .query_map(params![collection_id], |row| {
      Ok((row.get::<usize, String>(0)?, row.get::<usize, String>(1)?))
    })
    .map_err(|e| e.to_string())?;
  for row in tag_rows {
    let (normalized, original) = row.map_err(|e| e.to_string())?;
    push_filter_token(
      &mut bucket,
      &format!("tag:{}", normalized),
      &format!("Tag {}", original),
      "tag",
      "derived",
      55,
    );
  }

  let mut detail_stmt = connection
    .prepare(
      "SELECT DISTINCT c.type_line, c.color_identity_json, p.rarity, ci.language, ci.condition_code
       FROM collection_data_collection_items ci
       JOIN card_data_printings p ON p.id = ci.printing_id
       JOIN card_data_cards c ON c.id = p.card_id
       WHERE (?1 IS NULL OR ci.collection_id = ?1)
         AND (ci.quantity_nonfoil > 0 OR ci.quantity_foil > 0)",
    )
    .map_err(|e| e.to_string())?;
  let detail_rows = detail_stmt
    .query_map(params![collection_id], |row| {
      Ok((
        row.get::<usize, Option<String>>(0)?,
        row.get::<usize, Option<String>>(1)?,
        row.get::<usize, Option<String>>(2)?,
        row.get::<usize, String>(3)?,
        row.get::<usize, String>(4)?,
      ))
    })
    .map_err(|e| e.to_string())?;
  for row in detail_rows {
    let (type_line, color_json, rarity, language, condition_code) = row.map_err(|e| e.to_string())?;
    if let Some(primary_type) = extract_primary_type(type_line.as_deref()) {
      push_filter_token(
        &mut bucket,
        &format!("t:{}", primary_type),
        &format!("Type {}", primary_type),
        "type",
        "derived",
        60,
      );
    }
    let colors = parse_color_identity_json(color_json);
    if let Some(symbols) = normalize_color_symbols(&colors) {
      push_filter_token(
        &mut bucket,
        &format!("c:{}", symbols),
        &format!("Color {}", symbols.to_uppercase()),
        "color",
        "derived",
        65,
      );
    }
    if let Some(rarity_value) = rarity {
      let normalized = rarity_value.trim().to_lowercase();
      if !normalized.is_empty() {
        push_filter_token(
          &mut bucket,
          &format!("rarity:{}", normalized),
          &format!("Rarity {}", normalized),
          "rarity",
          "derived",
          70,
        );
      }
    }
    let lang = language.trim().to_lowercase();
    if !lang.is_empty() {
      push_filter_token(
        &mut bucket,
        &format!("lang:{}", lang),
        &format!("Language {}", lang.to_uppercase()),
        "language",
        "derived",
        75,
      );
    }
    let condition = condition_code.trim().to_lowercase();
    if !condition.is_empty() {
      push_filter_token(
        &mut bucket,
        &format!("cond:{}", condition),
        &format!("Condition {}", condition.to_uppercase()),
        "condition",
        "derived",
        80,
      );
    }
  }

  let mut tokens: Vec<FilterTokenDto> = bucket.into_values().collect();
  tokens.sort_by(|a, b| {
    a.priority
      .cmp(&b.priority)
      .then(a.token.to_lowercase().cmp(&b.token.to_lowercase()))
  });
  Ok(tokens)
}

fn sync_filter_tokens_for_profile(connection: &Connection, profile_id: &str) -> Result<i64, String> {
  ensure_profile_exists(connection, profile_id)?;
  let tokens = collect_filter_tokens(connection, Some(profile_id))?;
  Ok(tokens.len() as i64)
}

fn load_collection_rows(connection: &Connection, profile_id: &str) -> Result<Vec<OwnedCardDto>, String> {
  let mut statement = connection
    .prepare(
      "SELECT
         ci.id,
         p.id,
         c.name,
         p.set_code,
         p.collector_number,
         p.image_normal_url,
         c.type_line,
         c.color_identity_json,
         c.cmc,
         p.rarity,
         ci.quantity_nonfoil,
         ci.quantity_foil,
         ci.updated_at,
         ci.condition_code,
         ci.language,
         l.name,
         ci.notes,
         ci.purchase_price,
         ci.acquired_at
       FROM collection_data_collection_items ci
       JOIN card_data_printings p ON p.id = ci.printing_id
       JOIN card_data_cards c ON c.id = p.card_id
       LEFT JOIN collection_data_locations l ON l.id = ci.location_id
       WHERE ci.collection_id = ?1
         AND (ci.quantity_nonfoil > 0 OR ci.quantity_foil > 0)
       ORDER BY c.name COLLATE NOCASE",
    )
    .map_err(|e| e.to_string())?;

  let rows = statement
    .query_map(params![profile_id], |row| {
      Ok((
        row.get::<usize, String>(0)?,
        row.get::<usize, String>(1)?,
        row.get::<usize, String>(2)?,
        row.get::<usize, String>(3)?,
        row.get::<usize, String>(4)?,
        row.get::<usize, Option<String>>(5)?,
        row.get::<usize, Option<String>>(6)?,
        row.get::<usize, Option<String>>(7)?,
        row.get::<usize, Option<f64>>(8)?,
        row.get::<usize, Option<String>>(9)?,
        row.get::<usize, i64>(10)?,
        row.get::<usize, i64>(11)?,
        row.get::<usize, String>(12)?,
        row.get::<usize, String>(13)?,
        row.get::<usize, String>(14)?,
        row.get::<usize, Option<String>>(15)?,
        row.get::<usize, Option<String>>(16)?,
        row.get::<usize, Option<f64>>(17)?,
        row.get::<usize, Option<String>>(18)?,
      ))
    })
    .map_err(|e| e.to_string())?;

  let mut cards = Vec::new();
  for row in rows {
    let (
      owned_item_id,
      scryfall_id,
      name,
      set_code,
      collector_number,
      image_url,
      type_line,
      color_identity_json,
      mana_value,
      rarity,
      quantity,
      foil_quantity,
      updated_at,
      condition_code,
      language,
      location_name,
      notes,
      purchase_price,
      date_added,
    ) = row.map_err(|e| e.to_string())?;

    let existing_tags = load_tags_for_owned_item(connection, &owned_item_id)?;
    let tags = derive_tags(quantity, foil_quantity, existing_tags);
    let trend = build_price_trend(connection, &scryfall_id)?;

    cards.push(OwnedCardDto {
      scryfall_id,
      name,
      set_code,
      collector_number,
      image_url,
      type_line,
      color_identity: parse_color_identity_json(color_identity_json),
      mana_value,
      rarity,
      quantity,
      foil_quantity,
      updated_at,
      tags,
      current_price: trend.current_price,
      previous_price: trend.previous_price,
      price_delta: trend.price_delta,
      price_direction: trend.price_direction,
      last_price_at: trend.last_price_at,
      condition_code,
      language,
      location_name,
      notes,
      purchase_price,
      date_added,
    });
  }

  Ok(cards)
}

#[tauri::command]
fn list_profiles(state: State<'_, AppState>) -> Result<Vec<ProfileDto>, String> {
  let connection = open_database(&state.db_path)?;
  let mut statement = connection
    .prepare(
      "SELECT id, display_name, created_at
       FROM collection_data_profiles
       ORDER BY display_name COLLATE NOCASE",
    )
    .map_err(|e| e.to_string())?;

  let rows = statement
    .query_map([], |row| {
      Ok(ProfileDto {
        id: row.get(0)?,
        name: row.get(1)?,
        created_at: row.get(2)?,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut profiles = Vec::new();
  for row in rows {
    profiles.push(row.map_err(|e| e.to_string())?);
  }

  Ok(profiles)
}

#[tauri::command]
fn create_profile(state: State<'_, AppState>, name: String) -> Result<ProfileDto, String> {
  let normalized = name.trim().to_string();
  if normalized.is_empty() {
    return Err("Profile name is required.".to_string());
  }

  let connection = open_database(&state.db_path)?;
  let existing: Option<ProfileDto> = connection
    .query_row(
      "SELECT id, display_name, created_at
       FROM collection_data_profiles
       WHERE lower(display_name) = lower(?1)
       LIMIT 1",
      params![normalized],
      |row| {
        Ok(ProfileDto {
          id: row.get(0)?,
          name: row.get(1)?,
          created_at: row.get(2)?,
        })
      },
    )
    .optional()
    .map_err(|e| e.to_string())?;

  if let Some(profile) = existing {
    return Ok(profile);
  }

  let id = Uuid::new_v4().to_string();
  let now = now_iso();
  connection
    .execute(
      "INSERT INTO collection_data_profiles
         (id, display_name, owner_account_id, is_local_profile, created_at, updated_at)
       VALUES (?1, ?2, 'local-account', 1, ?3, ?3)",
      params![id, normalized, now],
    )
    .map_err(|e| e.to_string())?;
  connection
    .execute(
      "INSERT INTO collection_data_collections
         (id, profile_id, name, description, visibility, created_at, updated_at)
       VALUES (
         ?1,
         ?1,
         CASE
           WHEN instr(lower(?2), 'collection') > 0 THEN ?2
           ELSE ?2 || ' Collection'
         END,
         NULL,
         'private',
         ?3,
         ?3
       )",
      params![id, normalized, now],
    )
    .map_err(|e| e.to_string())?;

  Ok(ProfileDto {
    id,
    name: normalized,
    created_at: now,
  })
}

#[tauri::command]
fn get_collection(state: State<'_, AppState>, profile_id: String) -> Result<Vec<OwnedCardDto>, String> {
  let connection = open_database(&state.db_path)?;
  ensure_profile_exists(&connection, &profile_id)?;
  load_collection_rows(&connection, &profile_id)
}

#[tauri::command]
fn add_card_to_collection(
  state: State<'_, AppState>,
  input: AddCardInput,
) -> Result<Vec<OwnedCardDto>, String> {
  let connection = open_database(&state.db_path)?;
  ensure_profile_exists(&connection, &input.profile_id)?;
  let normalized_scryfall_id = input.scryfall_id.trim().to_lowercase();
  ensure_card_and_printing(
    &connection,
    &normalized_scryfall_id,
    &input.name,
    &input.set_code,
    &input.collector_number,
    input.image_url.as_deref(),
    input.type_line.as_deref(),
    input.color_identity.as_deref(),
    input.mana_value,
    input.rarity.as_deref(),
  )?;

  let existing: Option<(String, i64, i64)> = connection
    .query_row(
      "SELECT id, quantity_nonfoil, quantity_foil
       FROM collection_data_collection_items
       WHERE collection_id = ?1
         AND printing_id = ?2
         AND condition_code = 'NM'
         AND language = 'en'
         AND location_id IS NULL
       LIMIT 1",
      params![input.profile_id, normalized_scryfall_id],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  let now = now_iso();
  let owned_item_id = if let Some((owned_item_id, quantity, foil_quantity)) = existing {
    let next_quantity = if input.foil { quantity } else { quantity + 1 };
    let next_foil_quantity = if input.foil {
      foil_quantity + 1
    } else {
      foil_quantity
    };

    connection
      .execute(
        "UPDATE collection_data_collection_items
         SET quantity_nonfoil = ?1, quantity_foil = ?2, updated_at = ?3
         WHERE id = ?4",
        params![next_quantity, next_foil_quantity, now, owned_item_id],
      )
      .map_err(|e| e.to_string())?;

    owned_item_id
  } else {
    let id = Uuid::new_v4().to_string();
    let quantity = if input.foil { 0 } else { 1 };
    let foil_quantity = if input.foil { 1 } else { 0 };

    connection
      .execute(
        "INSERT INTO collection_data_collection_items (
           id, collection_id, printing_id, quantity_nonfoil, quantity_foil, condition_code, language,
           purchase_price, acquired_at, location_id, notes, created_at, updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, 'NM', 'en', NULL, ?6, NULL, NULL, ?6, ?6)",
        params![
          id,
          input.profile_id,
          normalized_scryfall_id,
          quantity,
          foil_quantity,
          now
        ],
      )
      .map_err(|e| e.to_string())?;

    id
  };

  if let Some(tags) = &input.tags {
    upsert_tags_for_owned_item(&connection, &input.profile_id, &owned_item_id, tags)?;
  }

  if let Some(price) = input.current_price {
    maybe_insert_market_snapshot(&connection, &normalized_scryfall_id, price, "scryfall", "market")?;
  }

  sync_filter_tokens_for_profile(&connection, &input.profile_id)?;
  load_collection_rows(&connection, &input.profile_id)
}

#[tauri::command]
fn update_card_quantity(
  state: State<'_, AppState>,
  input: QuantityInput,
) -> Result<Vec<OwnedCardDto>, String> {
  let connection = open_database(&state.db_path)?;
  ensure_profile_exists(&connection, &input.profile_id)?;
  let normalized_scryfall_id = input.scryfall_id.trim().to_lowercase();

  let existing: Option<(String, i64, i64)> = connection
    .query_row(
      "SELECT id, quantity_nonfoil, quantity_foil
       FROM collection_data_collection_items
       WHERE collection_id = ?1
         AND printing_id = ?2
         AND condition_code = 'NM'
         AND language = 'en'
         AND location_id IS NULL
       LIMIT 1",
      params![input.profile_id, normalized_scryfall_id],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  if let Some((owned_item_id, quantity, foil_quantity)) = existing {
    let mut next_quantity = quantity;
    let mut next_foil_quantity = foil_quantity;

    if input.foil {
      next_foil_quantity = (foil_quantity + input.delta).max(0);
    } else {
      next_quantity = (quantity + input.delta).max(0);
    }

    if next_quantity + next_foil_quantity <= 0 {
      connection
        .execute(
          "DELETE FROM collection_data_collection_items WHERE id = ?1",
          params![owned_item_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
      connection
        .execute(
          "UPDATE collection_data_collection_items
           SET quantity_nonfoil = ?1, quantity_foil = ?2, updated_at = ?3
           WHERE id = ?4",
          params![next_quantity, next_foil_quantity, now_iso(), owned_item_id],
        )
        .map_err(|e| e.to_string())?;
    }
  }

  sync_filter_tokens_for_profile(&connection, &input.profile_id)?;
  load_collection_rows(&connection, &input.profile_id)
}

#[tauri::command]
fn remove_card_from_collection(
  state: State<'_, AppState>,
  input: RemoveCardInput,
) -> Result<Vec<OwnedCardDto>, String> {
  let connection = open_database(&state.db_path)?;
  ensure_profile_exists(&connection, &input.profile_id)?;
  let normalized_scryfall_id = input.scryfall_id.trim().to_lowercase();

  connection
    .execute(
      "DELETE FROM collection_data_collection_items WHERE collection_id = ?1 AND printing_id = ?2",
      params![input.profile_id, normalized_scryfall_id],
    )
    .map_err(|e| e.to_string())?;

  sync_filter_tokens_for_profile(&connection, &input.profile_id)?;
  load_collection_rows(&connection, &input.profile_id)
}

#[tauri::command]
fn remove_cards_from_collection(
  state: State<'_, AppState>,
  input: RemoveCardsInput,
) -> Result<Vec<OwnedCardDto>, String> {
  let mut connection = open_database(&state.db_path)?;
  ensure_profile_exists(&connection, &input.profile_id)?;

  {
    let tx = connection.transaction().map_err(|e| e.to_string())?;
    let mut delete_stmt = tx
      .prepare(
        "DELETE FROM collection_data_collection_items
         WHERE collection_id = ?1
           AND printing_id = ?2",
      )
      .map_err(|e| e.to_string())?;

    let mut processed = 0_usize;
    for scryfall_id in input
      .scryfall_ids
      .iter()
      .map(|value| value.trim().to_lowercase())
      .filter(|value| !value.is_empty())
    {
      delete_stmt
        .execute(params![&input.profile_id, scryfall_id])
        .map_err(|e| e.to_string())?;
      processed += 1;
      if processed % 500 == 0 {
        // Yield briefly on very large removals to keep overall system responsiveness.
        thread::sleep(Duration::from_millis(2));
      }
    }
    drop(delete_stmt);
    tx.commit().map_err(|e| e.to_string())?;
  }

  sync_filter_tokens_for_profile(&connection, &input.profile_id)?;
  load_collection_rows(&connection, &input.profile_id)
}

#[tauri::command]
fn import_collection_rows(
  state: State<'_, AppState>,
  input: ImportCollectionInput,
) -> Result<Vec<OwnedCardDto>, String> {
  let mut connection = open_database(&state.db_path)?;
  ensure_profile_exists(&connection, &input.profile_id)?;

  {
    let tx = connection.transaction().map_err(|e| e.to_string())?;
    for row in input.rows {
      let row_scryfall_id = row.scryfall_id.trim().to_lowercase();
      let quantity = row.quantity.max(0);
      let foil_quantity = row.foil_quantity.max(0);
      if quantity + foil_quantity <= 0 {
        continue;
      }

      ensure_card_and_printing(
        &tx,
        &row_scryfall_id,
        &row.name,
        &row.set_code,
        &row.collector_number,
        row.image_url.as_deref(),
        row.type_line.as_deref(),
        row.color_identity.as_deref(),
        row.mana_value,
        row.rarity.as_deref(),
      )?;

      let now = now_iso();
      let next_condition = row
        .condition_code
        .as_deref()
        .map(|value| value.trim().to_uppercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "NM".to_string());
      let next_language = row
        .language
        .as_deref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "en".to_string());
      let notes = row
        .notes
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
      let date_added = row
        .date_added
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

      let mut location_id: Option<String> = None;
      if let Some(location_name) = row.location_name.as_deref() {
        let trimmed = location_name.trim();
        if !trimmed.is_empty() {
          let existing_location: Option<String> = tx
            .query_row(
              "SELECT id
               FROM collection_data_locations
               WHERE collection_id = ?1
                 AND LOWER(name) = LOWER(?2)
               LIMIT 1",
              params![&input.profile_id, trimmed],
              |db_row| db_row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

          location_id = if let Some(id) = existing_location {
            Some(id)
          } else {
            let id = Uuid::new_v4().to_string();
            tx.execute(
              "INSERT INTO collection_data_locations (id, collection_id, name, kind, created_at, updated_at)
               VALUES (?1, ?2, ?3, 'general', ?4, ?4)",
              params![id, &input.profile_id, trimmed, now],
            )
            .map_err(|e| e.to_string())?;
            Some(id)
          };
        }
      }

      let existing: Option<(String, i64, i64)> = tx
        .query_row(
          "SELECT id, quantity_nonfoil, quantity_foil
           FROM collection_data_collection_items
           WHERE collection_id = ?1
             AND printing_id = ?2
             AND condition_code = ?3
             AND language = ?4
             AND IFNULL(location_id, '') = IFNULL(?5, '')
           LIMIT 1",
          params![
            &input.profile_id,
            &row_scryfall_id,
            &next_condition,
            &next_language,
            location_id.as_deref()
          ],
          |db_row| Ok((db_row.get(0)?, db_row.get(1)?, db_row.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

      let owned_item_id = if let Some((owned_item_id, current_qty, current_foil_qty)) = existing {
        let next_qty = current_qty + quantity;
        let next_foil_qty = current_foil_qty + foil_quantity;
        tx.execute(
          "UPDATE collection_data_collection_items
           SET quantity_nonfoil = ?1,
               quantity_foil = ?2,
               purchase_price = COALESCE(?3, purchase_price),
               acquired_at = COALESCE(?4, acquired_at),
               notes = COALESCE(?5, notes),
               updated_at = ?6
           WHERE id = ?7",
          params![
            next_qty,
            next_foil_qty,
            row.purchase_price,
            date_added.as_deref(),
            notes.as_deref(),
            now,
            owned_item_id
          ],
        )
        .map_err(|e| e.to_string())?;
        owned_item_id
      } else {
        let owned_item_id = Uuid::new_v4().to_string();
        tx.execute(
          "INSERT INTO collection_data_collection_items (
             id, collection_id, printing_id, quantity_nonfoil, quantity_foil, condition_code, language,
             purchase_price, acquired_at, location_id, notes, created_at, updated_at
           )
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
          params![
            owned_item_id,
            &input.profile_id,
            &row_scryfall_id,
            quantity,
            foil_quantity,
            &next_condition,
            &next_language,
            row.purchase_price,
            date_added.as_deref(),
            location_id.as_deref(),
            notes.as_deref(),
            now
          ],
        )
        .map_err(|e| e.to_string())?;
        owned_item_id
      };

      let mut merged_tags = load_tags_for_owned_item(&tx, &owned_item_id)?;
      if let Some(row_tags) = row.tags {
        merged_tags.extend(row_tags);
      }
      if !merged_tags.is_empty() {
        upsert_tags_for_owned_item(&tx, &input.profile_id, &owned_item_id, &merged_tags)?;
      }
    }
    tx.commit().map_err(|e| e.to_string())?;
  }

  sync_filter_tokens_for_profile(&connection, &input.profile_id)?;
  load_collection_rows(&connection, &input.profile_id)
}

#[tauri::command]
fn hydrate_profile_card_metadata(
  state: State<'_, AppState>,
  input: HydrateProfileCardMetadataInput,
) -> Result<HydrateProfileCardMetadataResult, String> {
  let connection = open_database(&state.db_path)?;
  ensure_profile_exists(&connection, &input.profile_id)?;

  let max_cards = input.max_cards.unwrap_or(1200).max(75).min(9000) as i64;
  let targets = list_missing_metadata_scryfall_ids(&connection, &input.profile_id, max_cards)?;
  if targets.is_empty() {
    return Ok(HydrateProfileCardMetadataResult {
      attempted: 0,
      hydrated: 0,
      remaining: 0,
    });
  }

  let mut hydrated = 0_i64;
  for batch in targets.chunks(75) {
    let cards = fetch_scryfall_collection_cards(batch)?;
    hydrated += hydrate_printing_metadata_batch(&connection, &cards)?;
    thread::sleep(Duration::from_millis(80));
  }

  sync_filter_tokens_for_profile(&connection, &input.profile_id)?;
  let remaining = count_missing_metadata_rows(&connection, &input.profile_id)?;

  Ok(HydrateProfileCardMetadataResult {
    attempted: targets.len() as i64,
    hydrated,
    remaining,
  })
}

#[tauri::command]
fn bulk_update_tags(
  state: State<'_, AppState>,
  input: BulkUpdateTagsInput,
) -> Result<Vec<OwnedCardDto>, String> {
  let mut connection = open_database(&state.db_path)?;
  ensure_profile_exists(&connection, &input.profile_id)?;

  if input.scryfall_ids.is_empty() {
    return load_collection_rows(&connection, &input.profile_id);
  }

  let manual_tags: Vec<String> = input
    .tags
    .iter()
    .map(|tag| tag.trim().to_string())
    .filter(|tag| !tag.is_empty())
    .collect();

  {
    let tx = connection.transaction().map_err(|e| e.to_string())?;

    for scryfall_id in input.scryfall_ids {
      let normalized_scryfall_id = scryfall_id.trim().to_lowercase();
      let found: Option<(String, i64, i64)> = tx
        .query_row(
          "SELECT id, quantity_nonfoil, quantity_foil
           FROM collection_data_collection_items
           WHERE collection_id = ?1
             AND printing_id = ?2
             AND condition_code = 'NM'
             AND language = 'en'
             AND location_id IS NULL
           LIMIT 1",
          params![&input.profile_id, &normalized_scryfall_id],
          |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

      let Some((owned_item_id, quantity, foil_quantity)) = found else {
        continue;
      };

      let mut next_tags = load_tags_for_owned_item(&tx, &owned_item_id)?;
      next_tags.extend(manual_tags.clone());
      if input.include_auto_rules {
        next_tags = derive_tags(quantity, foil_quantity, next_tags);
      } else {
        next_tags.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
        next_tags.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
      }

      upsert_tags_for_owned_item(&tx, &input.profile_id, &owned_item_id, &next_tags)?;
    }

    tx.commit().map_err(|e| e.to_string())?;
  }

  sync_filter_tokens_for_profile(&connection, &input.profile_id)?;
  load_collection_rows(&connection, &input.profile_id)
}

#[tauri::command]
fn update_owned_card_metadata(
  state: State<'_, AppState>,
  input: UpdateOwnedCardMetadataInput,
) -> Result<Vec<OwnedCardDto>, String> {
  let connection = open_database(&state.db_path)?;
  ensure_profile_exists(&connection, &input.profile_id)?;
  let normalized_scryfall_id = input.scryfall_id.trim().to_lowercase();

  let found: Option<String> = connection
    .query_row(
      "SELECT id
       FROM collection_data_collection_items
       WHERE collection_id = ?1
         AND printing_id = ?2
       ORDER BY updated_at DESC
       LIMIT 1",
      params![&input.profile_id, &normalized_scryfall_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  let Some(owned_item_id) = found else {
    return Err(format!("Owned card not found for {}", input.scryfall_id));
  };

  let mut location_id: Option<String> = None;
  if let Some(location_name) = input.location_name.as_deref() {
    let trimmed = location_name.trim();
    if !trimmed.is_empty() {
      let existing_location: Option<String> = connection
        .query_row(
          "SELECT id FROM collection_data_locations WHERE collection_id = ?1 AND lower(name) = lower(?2) LIMIT 1",
          params![&input.profile_id, trimmed],
          |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
      location_id = if let Some(id) = existing_location {
        Some(id)
      } else {
        let id = Uuid::new_v4().to_string();
        let now = now_iso();
        connection
          .execute(
            "INSERT INTO collection_data_locations (id, collection_id, name, kind, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'box', ?4, ?4)",
            params![&id, &input.profile_id, trimmed, now],
          )
          .map_err(|e| e.to_string())?;
        Some(id)
      };
    }
  }

  let next_condition = input
    .condition_code
    .as_deref()
    .map(|value| value.trim().to_uppercase())
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| "NM".to_string());
  let next_language = input
    .language
    .as_deref()
    .map(|value| value.trim().to_lowercase())
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| "en".to_string());
  let notes = input
    .notes
    .as_deref()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  let date_added = input
    .date_added
    .as_deref()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());

  connection
    .execute(
      "UPDATE collection_data_collection_items
       SET condition_code = ?1,
           language = ?2,
           location_id = ?3,
           notes = ?4,
           purchase_price = ?5,
           acquired_at = ?6,
           updated_at = ?7
       WHERE id = ?8",
      params![
        next_condition,
        next_language,
        location_id,
        notes,
        input.purchase_price,
        date_added,
        now_iso(),
        owned_item_id
      ],
    )
    .map_err(|e| e.to_string())?;

  sync_filter_tokens_for_profile(&connection, &input.profile_id)?;
  load_collection_rows(&connection, &input.profile_id)
}

#[tauri::command]
fn set_owned_card_state(
  state: State<'_, AppState>,
  input: SetOwnedCardStateInput,
) -> Result<Vec<OwnedCardDto>, String> {
  let connection = open_database(&state.db_path)?;
  ensure_profile_exists(&connection, &input.profile_id)?;

  let quantity = input.card.quantity.max(0);
  let foil_quantity = input.card.foil_quantity.max(0);
  let normalized_scryfall_id = input.card.scryfall_id.trim().to_lowercase();
  // Undo pipeline can restore a prior "missing" card by sending 0 total quantity.
  if quantity + foil_quantity <= 0 {
    connection
      .execute(
        "DELETE FROM collection_data_collection_items WHERE collection_id = ?1 AND printing_id = ?2",
        params![&input.profile_id, &normalized_scryfall_id],
      )
      .map_err(|e| e.to_string())?;
    sync_filter_tokens_for_profile(&connection, &input.profile_id)?;
    return load_collection_rows(&connection, &input.profile_id);
  }

  ensure_card_and_printing(
    &connection,
    &normalized_scryfall_id,
    &input.card.name,
    &input.card.set_code,
    &input.card.collector_number,
    input.card.image_url.as_deref(),
    input.card.type_line.as_deref(),
    input.card.color_identity.as_deref(),
    input.card.mana_value,
    input.card.rarity.as_deref(),
  )?;

  let existing_owned_item_id: Option<String> = connection
    .query_row(
      "SELECT id
       FROM collection_data_collection_items
       WHERE collection_id = ?1
         AND printing_id = ?2
       ORDER BY updated_at DESC
       LIMIT 1",
      params![&input.profile_id, &normalized_scryfall_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  let mut location_id: Option<String> = None;
  if let Some(location_name) = input.card.location_name.as_deref() {
    let trimmed = location_name.trim();
    if !trimmed.is_empty() {
      let existing_location: Option<String> = connection
        .query_row(
          "SELECT id FROM collection_data_locations WHERE collection_id = ?1 AND lower(name) = lower(?2) LIMIT 1",
          params![&input.profile_id, trimmed],
          |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
      location_id = if let Some(id) = existing_location {
        Some(id)
      } else {
        let id = Uuid::new_v4().to_string();
        let now = now_iso();
        connection
          .execute(
            "INSERT INTO collection_data_locations (id, collection_id, name, kind, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'box', ?4, ?4)",
            params![&id, &input.profile_id, trimmed, now],
          )
          .map_err(|e| e.to_string())?;
        Some(id)
      };
    }
  }

  let next_condition = input
    .card
    .condition_code
    .as_deref()
    .map(|value| value.trim().to_uppercase())
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| "NM".to_string());
  let next_language = input
    .card
    .language
    .as_deref()
    .map(|value| value.trim().to_lowercase())
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| "en".to_string());
  let notes = input
    .card
    .notes
    .as_deref()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  let date_added = input
    .card
    .date_added
    .as_deref()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  let now = now_iso();

  let owned_item_id = if let Some(owned_item_id) = existing_owned_item_id {
    connection
      .execute(
        "UPDATE collection_data_collection_items
         SET quantity_nonfoil = ?1,
             quantity_foil = ?2,
             condition_code = ?3,
             language = ?4,
             location_id = ?5,
             notes = ?6,
             purchase_price = ?7,
             acquired_at = ?8,
             updated_at = ?9
         WHERE id = ?10",
        params![
          quantity,
          foil_quantity,
          next_condition,
          next_language,
          location_id,
          notes,
          input.card.purchase_price,
          date_added,
          now,
          owned_item_id
        ],
      )
      .map_err(|e| e.to_string())?;
    owned_item_id
  } else {
    let owned_item_id = Uuid::new_v4().to_string();
    connection
      .execute(
        "INSERT INTO collection_data_collection_items (
           id, collection_id, printing_id, quantity_nonfoil, quantity_foil, condition_code, language,
           purchase_price, acquired_at, location_id, notes, created_at, updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
        params![
          &owned_item_id,
          &input.profile_id,
          &normalized_scryfall_id,
          quantity,
          foil_quantity,
          next_condition,
          next_language,
          input.card.purchase_price,
          date_added,
          location_id,
          notes,
          now
        ],
      )
      .map_err(|e| e.to_string())?;
    owned_item_id
  };

  // Re-derive system tags so restored rows keep consistent `owned/foil/playset` semantics.
  let normalized_tags = derive_tags(quantity, foil_quantity, input.card.tags.clone());
  upsert_tags_for_owned_item(&connection, &input.profile_id, &owned_item_id, &normalized_tags)?;

  sync_filter_tokens_for_profile(&connection, &input.profile_id)?;
  load_collection_rows(&connection, &input.profile_id)
}

#[tauri::command]
fn get_catalog_sync_state(
  state: State<'_, AppState>,
  dataset: Option<String>,
) -> Result<CatalogSyncStateDto, String> {
  let connection = open_database(&state.db_path)?;
  let normalized_dataset = normalize_catalog_dataset(dataset.as_deref())?;
  load_catalog_sync_state(&connection, &normalized_dataset)
}

#[tauri::command]
fn get_catalog_price_records(
  state: State<'_, AppState>,
  dataset: Option<String>,
  scryfall_ids: Vec<String>,
) -> Result<Vec<CatalogPriceRecordDto>, String> {
  let connection = open_database(&state.db_path)?;
  let normalized_dataset = normalize_catalog_dataset(dataset.as_deref())?;

  if scryfall_ids.is_empty() {
    return Ok(Vec::new());
  }

  let (current_version, _, _) = read_catalog_sync_row(&connection, &normalized_dataset)?;
  let Some(sync_version) = current_version else {
    return Ok(Vec::new());
  };
  if sync_version.trim().is_empty() {
    return Ok(Vec::new());
  }

  let mut statement = connection
    .prepare(
      "SELECT p.id, c.name, p.set_code, p.collector_number, p.image_normal_url, cp.tcg_market, cp.captured_at
       FROM card_data_card_prices cp
       JOIN card_data_printings p ON p.id = cp.printing_id
       JOIN card_data_cards c ON c.id = p.card_id
       WHERE p.id = ?1
         AND cp.sync_version = ?2
         AND cp.tcg_market IS NOT NULL
       ORDER BY cp.captured_at DESC
       LIMIT 1",
    )
    .map_err(|e| e.to_string())?;

  let mut rows_out = Vec::new();
  for scryfall_id in scryfall_ids {
    let found = statement
      .query_row(
        params![scryfall_id.trim().to_lowercase(), sync_version],
        |row| {
        Ok(CatalogPriceRecordDto {
          scryfall_id: row.get(0)?,
          name: row.get(1)?,
          set_code: row.get(2)?,
          collector_number: row.get(3)?,
          image_url: row.get(4)?,
          market_price: row.get(5)?,
          low_price: None,
          mid_price: None,
          high_price: None,
          updated_at: row.get(6)?,
        })
        },
      )
      .optional()
      .map_err(|e| e.to_string())?;

    if let Some(record) = found {
      rows_out.push(record);
    }
  }

  Ok(rows_out)
}

#[tauri::command]
fn apply_catalog_snapshot(
  state: State<'_, AppState>,
  input: CatalogSnapshotApplyInput,
) -> Result<CatalogApplyResultDto, String> {
  let mut connection = open_database(&state.db_path)?;
  let normalized_dataset = normalize_catalog_dataset(input.dataset.as_deref())?;
  let to_version = input.version.trim().to_string();
  if to_version.is_empty() {
    return Err("Catalog snapshot apply requires version.".to_string());
  }

  let strategy = input
    .strategy
    .unwrap_or_else(|| "full".to_string())
    .trim()
    .to_lowercase();

  let tx = connection.transaction().map_err(|e| e.to_string())?;
  let (from_version, _, _) = read_catalog_sync_row(&tx, &normalized_dataset)?;

  tx.execute(
    "DELETE FROM card_data_card_prices
     WHERE sync_version = ?1",
    params![&to_version],
  )
    .map_err(|e| e.to_string())?;
  for row in input.records.iter() {
    upsert_catalog_record(&tx, row, &to_version)?;
  }

  write_catalog_sync_state(&tx, &normalized_dataset, Some(&to_version), None)?;
  let computed_state_hash = compute_catalog_state_hash(&tx, &normalized_dataset)?;
  if let Some(expected_hash) = input.snapshot_hash.as_deref() {
    if !expected_hash.trim().is_empty() && expected_hash != computed_state_hash {
      return Err(format!(
        "Snapshot hash mismatch. expected {}, computed {}",
        expected_hash, computed_state_hash
      ));
    }
  }

  write_catalog_sync_state(
    &tx,
    &normalized_dataset,
    Some(&to_version),
    Some(&computed_state_hash),
  )?;
  let total_records = count_catalog_records(&tx, &normalized_dataset)?;
  append_catalog_patch_history(
    &tx,
    &normalized_dataset,
    from_version.as_deref(),
    &to_version,
    &strategy,
    input.snapshot_hash.as_deref(),
    input.records.len() as i64,
    0,
    0,
    total_records,
  )?;
  tx.commit().map_err(|e| e.to_string())?;

  Ok(CatalogApplyResultDto {
    dataset: normalized_dataset,
    from_version,
    to_version,
    strategy,
    patch_hash: input.snapshot_hash,
    state_hash: computed_state_hash,
    total_records,
    added_count: input.records.len() as i64,
    updated_count: 0,
    removed_count: 0,
  })
}

#[tauri::command]
fn apply_catalog_patch(
  state: State<'_, AppState>,
  input: CatalogPatchApplyInput,
) -> Result<CatalogApplyResultDto, String> {
  let mut connection = open_database(&state.db_path)?;
  let normalized_dataset = normalize_catalog_dataset(input.dataset.as_deref())?;

  let from_version = input.from_version.trim().to_string();
  let to_version = input.to_version.trim().to_string();
  if from_version.is_empty() || to_version.is_empty() {
    return Err("Catalog patch apply requires fromVersion and toVersion.".to_string());
  }

  let strategy = input
    .strategy
    .unwrap_or_else(|| "chain".to_string())
    .trim()
    .to_lowercase();

  let tx = connection.transaction().map_err(|e| e.to_string())?;
  let (current_version, _, _) = read_catalog_sync_row(&tx, &normalized_dataset)?;
  let current_version_text = current_version.unwrap_or_else(|| "none".to_string());
  if current_version_text != from_version {
    return Err(format!(
      "Catalog version mismatch. Local is {}, patch expects {}.",
      current_version_text, from_version
    ));
  }

  let to_captured_ymd = captured_ymd_from_sync_version(&to_version).unwrap_or_else(current_captured_ymd);
  let to_captured_at = now_iso();
  tx.execute(
    "DELETE FROM card_data_card_prices
     WHERE sync_version = ?1",
    params![&to_version],
  )
  .map_err(|e| e.to_string())?;
  tx.execute(
    "INSERT INTO card_data_card_prices (
       printing_id, condition_id, finish_id,
       tcg_low, tcg_market, tcg_high,
       ck_sell, ck_buylist, ck_buylist_quantity_cap,
       sync_version, captured_ymd, captured_at, created_at
     )
     SELECT
       printing_id, condition_id, finish_id,
       tcg_low, tcg_market, tcg_high,
       ck_sell, ck_buylist, ck_buylist_quantity_cap,
       ?1, ?2, ?3, ?3
     FROM card_data_card_prices
     WHERE sync_version = ?4",
    params![&to_version, to_captured_ymd, to_captured_at, &from_version],
  )
  .map_err(|e| e.to_string())?;

  for scryfall_id in input.removed.iter().map(|id| id.trim()).filter(|id| !id.is_empty()) {
    tx.execute(
      "DELETE FROM card_data_card_prices
       WHERE sync_version = ?1
         AND printing_id = ?2",
      params![&to_version, scryfall_id.to_lowercase()],
    )
    .map_err(|e| e.to_string())?;
  }

  for row in input.added.iter() {
    upsert_catalog_record(&tx, row, &to_version)?;
  }
  for row in input.updated.iter() {
    upsert_catalog_record(&tx, row, &to_version)?;
  }

  write_catalog_sync_state(&tx, &normalized_dataset, Some(&to_version), None)?;
  let computed_state_hash = compute_catalog_state_hash(&tx, &normalized_dataset)?;
  write_catalog_sync_state(
    &tx,
    &normalized_dataset,
    Some(&to_version),
    Some(&computed_state_hash),
  )?;
  let total_records = count_catalog_records(&tx, &normalized_dataset)?;
  append_catalog_patch_history(
    &tx,
    &normalized_dataset,
    Some(&from_version),
    &to_version,
    &strategy,
    input.patch_hash.as_deref(),
    input.added.len() as i64,
    input.updated.len() as i64,
    input.removed.len() as i64,
    total_records,
  )?;
  tx.commit().map_err(|e| e.to_string())?;

  Ok(CatalogApplyResultDto {
    dataset: normalized_dataset,
    from_version: Some(from_version),
    to_version,
    strategy,
    patch_hash: input.patch_hash,
    state_hash: computed_state_hash,
    total_records,
    added_count: input.added.len() as i64,
    updated_count: input.updated.len() as i64,
    removed_count: input.removed.len() as i64,
  })
}

#[tauri::command]
fn reset_catalog_sync_state_for_test(
  state: State<'_, AppState>,
  dataset: Option<String>,
) -> Result<CatalogSyncStateDto, String> {
  let mut connection = open_database(&state.db_path)?;
  let normalized_dataset = normalize_catalog_dataset(dataset.as_deref())?;
  let tx = connection.transaction().map_err(|e| e.to_string())?;

  tx.execute(
    "DELETE FROM card_data_card_prices",
    [],
  )
    .map_err(|e| e.to_string())?;
  tx.execute(
    "DELETE FROM system_data_sync_client_sync_state
     WHERE client_id = ?1
       AND dataset_name = ?2",
    params![LOCAL_SYNC_CLIENT_ID, &normalized_dataset],
  )
  .map_err(|e| e.to_string())?;
  tx.execute(
    "DELETE FROM system_data_sync_patch_apply_history
     WHERE client_id = ?1
       AND dataset_name = ?2",
    params![LOCAL_SYNC_CLIENT_ID, &normalized_dataset],
  )
  .map_err(|e| e.to_string())?;
  tx.execute(
    "DELETE FROM system_data_sync_patches WHERE dataset_name = ?1",
    params![&normalized_dataset],
  )
  .map_err(|e| e.to_string())?;
  tx.execute(
    "DELETE FROM system_data_sync_dataset_versions WHERE dataset_name = ?1",
    params![&normalized_dataset],
  )
  .map_err(|e| e.to_string())?;

  tx.commit().map_err(|e| e.to_string())?;
  let connection = open_database(&state.db_path)?;
  load_catalog_sync_state(&connection, &normalized_dataset)
}

#[tauri::command]
fn optimize_catalog_storage(
  state: State<'_, AppState>,
  dataset: Option<String>,
) -> Result<String, String> {
  let connection = open_database(&state.db_path)?;
  let normalized_dataset = normalize_catalog_dataset(dataset.as_deref())?;

  connection
    .execute_batch(
      "
      PRAGMA optimize;
      ANALYZE card_data_card_prices;
      ANALYZE card_data_printings;
      ANALYZE card_data_cards;
      REINDEX idx_card_data_card_prices_printing_time;
      REINDEX idx_card_data_card_prices_sync_version;
      REINDEX idx_card_data_printings_set_collector;
      VACUUM;
      ",
    )
    .map_err(|e| e.to_string())?;

  Ok(format!("Catalog storage optimized for dataset '{}'.", normalized_dataset))
}

#[tauri::command]
fn sync_filter_tokens(
  state: State<'_, AppState>,
  profile_id: String,
) -> Result<i64, String> {
  let connection = open_database(&state.db_path)?;
  sync_filter_tokens_for_profile(&connection, &profile_id)
}

#[tauri::command]
fn get_filter_tokens(
  state: State<'_, AppState>,
  input: Option<FilterTokenQueryInput>,
) -> Result<Vec<FilterTokenDto>, String> {
  let connection = open_database(&state.db_path)?;
  let query = input
    .as_ref()
    .and_then(|value| value.query.as_ref())
    .map(|value| value.trim().to_lowercase())
    .unwrap_or_default();
  let limit = input
    .as_ref()
    .and_then(|value| value.limit)
    .unwrap_or(FILTER_TOKEN_DEFAULT_LIMIT)
    .clamp(1, 100);
  let tokens = collect_filter_tokens(&connection, None)?;
  let filtered: Vec<FilterTokenDto> = tokens
    .into_iter()
    .filter(|token| {
      if query.is_empty() {
        true
      } else {
        token.token.to_lowercase().contains(&query) || token.label.to_lowercase().contains(&query)
      }
    })
    .take(limit as usize)
    .collect();
  Ok(filtered)
}

#[tauri::command]
fn record_market_snapshots(
  state: State<'_, AppState>,
  snapshots: Vec<MarketSnapshotInput>,
) -> Result<(), String> {
  let connection = open_database(&state.db_path)?;

  for snapshot in snapshots {
    let normalized_scryfall_id = snapshot.scryfall_id.trim().to_lowercase();
    ensure_card_and_printing(
      &connection,
      &normalized_scryfall_id,
      &snapshot.name,
      &snapshot.set_code,
      &snapshot.collector_number,
      snapshot.image_url.as_deref(),
      None,
      None,
      None,
      None,
    )?;

    if let Some(price) = snapshot.market_price {
      maybe_insert_market_snapshot(&connection, &normalized_scryfall_id, price, "scryfall", "market")?;
      maybe_insert_market_snapshot(&connection, &normalized_scryfall_id, price, "tcgplayer", "market")?;
      maybe_insert_market_snapshot(&connection, &normalized_scryfall_id, price, "tcgplayer", "low")?;
      maybe_insert_market_snapshot(&connection, &normalized_scryfall_id, price, "tcgplayer", "high")?;
    }
  }

  Ok(())
}

#[tauri::command]
fn get_market_price_trends(
  state: State<'_, AppState>,
  scryfall_ids: Vec<String>,
) -> Result<Vec<MarketTrendDto>, String> {
  let connection = open_database(&state.db_path)?;
  let mut trends = Vec::new();

  for scryfall_id in scryfall_ids {
    let normalized_scryfall_id = scryfall_id.trim().to_lowercase();
    let trend = build_price_trend(&connection, &normalized_scryfall_id)?;
    trends.push(MarketTrendDto {
      scryfall_id: normalized_scryfall_id,
      current_price: trend.current_price,
      previous_price: trend.previous_price,
      price_delta: trend.price_delta,
      price_direction: trend.price_direction,
      last_price_at: trend.last_price_at,
    });
  }

  Ok(trends)
}

#[tauri::command]
fn get_collection_price_trends_by_source(
  state: State<'_, AppState>,
  profile_id: String,
  source_id: String,
) -> Result<Vec<MarketTrendDto>, String> {
  let connection = open_database(&state.db_path)?;
  ensure_profile_exists(&connection, &profile_id)?;
  load_collection_price_trends_by_source(&connection, &profile_id, &source_id)
}

#[tauri::command]
fn sync_ck_prices_into_card_data(
  state: State<'_, AppState>,
) -> Result<CkPriceSyncResultDto, String> {
  let mut connection = open_database(&state.db_path)?;
  let rows = load_ck_pricelist_items(&state)?;
  if rows.is_empty() {
    return Ok(CkPriceSyncResultDto {
      scanned: 0,
      upserted_buylist: 0,
      upserted_sell: 0,
      skipped: 0,
    });
  }

  let now = now_iso();
  let sync_version = sync_version_from_iso(&now);
  let captured_ymd = captured_ymd_from_iso(&now).unwrap_or_else(current_captured_ymd);
  let tx = connection.transaction().map_err(|e| e.to_string())?;
  let mut scanned = 0_i64;
  let mut upserted_buylist = 0_i64;
  let mut upserted_sell = 0_i64;
  let mut skipped = 0_i64;

  for row in rows {
    scanned += 1;
    if scanned % SYNC_YIELD_EVERY_ROWS == 0 {
      thread::sleep(Duration::from_millis(SYNC_YIELD_SLEEP_MS));
    }
    let scryfall_id = row.scryfall_id.unwrap_or_default().trim().to_lowercase();
    if scryfall_id.is_empty() {
      skipped += 1;
      continue;
    }
    let printing_exists = tx
      .query_row(
        "SELECT 1 FROM card_data_printings WHERE id = ?1 LIMIT 1",
        params![&scryfall_id],
        |row| row.get::<usize, i64>(0),
      )
      .optional()
      .map_err(|e| e.to_string())?
      .is_some();
    if !printing_exists {
      skipped += 1;
      continue;
    }
    let buy_price = parse_ck_price(row.price_buy.as_deref());
    let sell_price = parse_ck_price(row.price_sell.as_deref());
    let finish_id = if parse_ck_bool(row.is_foil.as_deref()) {
      2
    } else {
      FINISH_NONFOIL_ID
    };

    if buy_price > 0.0 {
      upsert_compact_price_row(
        &tx,
        &scryfall_id,
        Some(CONDITION_NM_ID),
        Some(finish_id),
        None,
        None,
        None,
        None,
        Some(buy_price),
        Some(row.qty_buying.unwrap_or(0)),
        &sync_version,
        captured_ymd,
        &now,
      )?;
      upserted_buylist += 1;
    }

    if sell_price > 0.0 {
      upsert_compact_price_row(
        &tx,
        &scryfall_id,
        Some(CONDITION_NM_ID),
        Some(finish_id),
        None,
        None,
        None,
        Some(sell_price),
        None,
        None,
        &sync_version,
        captured_ymd,
        &now,
      )?;
      upserted_sell += 1;
    }

    if buy_price <= 0.0 && sell_price <= 0.0 {
      skipped += 1;
    }
  }

  tx.commit().map_err(|e| e.to_string())?;
  Ok(CkPriceSyncResultDto {
    scanned,
    upserted_buylist,
    upserted_sell,
    skipped,
  })
}

#[tauri::command]
fn sync_all_sources_now(
  state: State<'_, AppState>,
) -> Result<FullSourceSyncResultDto, String> {
  let started_at = now_iso();
  let sync_version = sync_version_from_iso(&started_at);
  let captured_ymd = captured_ymd_from_iso(&started_at).unwrap_or_else(current_captured_ymd);
  let connection = open_database(&state.db_path)?;

  ensure_sync_source(
    &connection,
    SCRYFALL_SOURCE_ID,
    "snapshot",
    "https://api.scryfall.com/cards/collection",
    Some("22:00Z"),
  )?;
  ensure_sync_source(
    &connection,
    TCGTRACKING_SOURCE_ID,
    "snapshot",
    "https://tcgtracking.com/tcgapi/v1/1",
    None,
  )?;
  ensure_sync_source(
    &connection,
    CK_SOURCE_ID,
    "snapshot",
    CK_PRICELIST_URL,
    None,
  )?;

  let mut scryfall_scanned = 0_i64;
  let mut scryfall_updated = 0_i64;
  let mut scryfall_unchanged = 0_i64;
  let scryfall_price_snapshots = 0_i64;

  // Step 1: TCGTracking full pricing sync (global).
  let mut tcg_sets_scanned = 0_i64;
  let mut tcg_products_matched = 0_i64;
  let mut tcg_price_upserts = 0_i64;
  let set_list = fetch_tcgtracking_set_list()?;
  for set_item in set_list {
    let set_id = set_item.id;
    tcg_sets_scanned += 1;
    let products_payload = match fetch_tcgtracking_set_products(set_id) {
      Ok(value) => value,
      Err(_) => continue,
    };
    let pricing_payload = match fetch_tcgtracking_set_pricing(set_id) {
      Ok(value) => value,
      Err(_) => continue,
    };
    let skus_payload = match fetch_tcgtracking_set_skus(set_id) {
      Ok(value) => value,
      Err(_) => continue,
    };
    if tcg_sets_scanned % 10 == 0 {
      thread::sleep(Duration::from_millis(SYNC_YIELD_SLEEP_MS));
    }

    for product in products_payload.products.values() {
      let Some(scryfall_id) = product
        .scryfall_id
        .as_deref()
        .map(|value| value.trim().to_lowercase())
      else {
        continue;
      };
      let exists = connection
        .query_row(
          "SELECT 1 FROM card_data_printings WHERE id = ?1 LIMIT 1",
          params![&scryfall_id],
          |row| row.get::<usize, i64>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .is_some();
      if !exists {
        continue;
      }
      tcg_products_matched += 1;
      if tcg_products_matched % SYNC_YIELD_EVERY_ROWS == 0 {
        thread::sleep(Duration::from_millis(SYNC_YIELD_SLEEP_MS));
      }
      let product_key = product.id.to_string();
      let pricing_row = pricing_payload.prices.get(&product_key);
      let sku_map = skus_payload.products.get(&product_key);

      let normal = pricing_row.and_then(|row| row.tcg.as_ref()).and_then(|tcg| tcg.normal);
      let foil = pricing_row.and_then(|row| row.tcg.as_ref()).and_then(|tcg| tcg.foil);
      let chosen = normal.or(foil);
      let Some(chosen_price) = chosen else {
        continue;
      };
      let market = chosen_price.market.or(chosen_price.low);
      let low = chosen_price.low.or(chosen_price.market);

      let high = sku_map.and_then(|rows| {
        let mut preferred: Option<f64> = None;
        for sku in rows.values() {
          let cnd = sku.cnd.as_deref().unwrap_or("").trim().to_uppercase();
          let lng = sku.lng.as_deref().unwrap_or("").trim().to_uppercase();
          if cnd != "NM" || lng != "EN" {
            continue;
          }
          if let Some(value) = sku.hi {
            let variant = sku.var.as_deref().unwrap_or("N").trim().to_uppercase();
            if variant == "N" {
              return Some(value);
            }
            preferred = Some(value);
          }
        }
        preferred
      });

      if market.is_some() || low.is_some() || high.is_some() {
        upsert_compact_price_row(
          &connection,
          &scryfall_id,
          Some(CONDITION_NM_ID),
          Some(FINISH_NONFOIL_ID),
          low,
          market,
          high,
          None,
          None,
          None,
          &sync_version,
          captured_ymd,
          &started_at,
        )?;
        tcg_price_upserts += [market, low, high]
          .iter()
          .filter(|value| value.is_some())
          .count() as i64;
      }
    }
  }

  // Step 2: Card Kingdom pricing sync (global).
  let ck_result = sync_ck_prices_into_card_data(state)?;

  // Step 3: Scryfall full oracle/card metadata sync (global, no pricing writes).
  let global_scryfall_cards = fetch_scryfall_default_cards_bulk()?;
  for card in global_scryfall_cards {
    scryfall_scanned += 1;
    if scryfall_scanned % SYNC_YIELD_EVERY_ROWS == 0 {
      thread::sleep(Duration::from_millis(SYNC_YIELD_SLEEP_MS));
    }
    if upsert_scryfall_oracle_if_changed(&connection, &card)? {
      scryfall_updated += 1;
    } else {
      scryfall_unchanged += 1;
    }
  }

  write_source_sync_record(
    &connection,
    SCRYFALL_SOURCE_ID,
    "default_cards_live",
    &sync_version,
    scryfall_scanned,
    None,
  )?;
  write_source_sync_record(
    &connection,
    TCGTRACKING_SOURCE_ID,
    "tcgtracking_tcgplayer_live",
    &sync_version,
    tcg_products_matched,
    None,
  )?;
  write_source_sync_record(
    &connection,
    CK_SOURCE_ID,
    "ck_pricelist_live",
    &sync_version,
    ck_result.scanned,
    None,
  )?;
  write_catalog_sync_state(&connection, CATALOG_DATASET_DEFAULT, Some(&sync_version), None)?;

  let finished_at = now_iso();
  Ok(FullSourceSyncResultDto {
    started_at,
    finished_at,
    sync_version,
    scryfall_scanned,
    scryfall_updated,
    scryfall_unchanged,
    scryfall_price_snapshots,
    tcg_sets_scanned,
    tcg_products_matched,
    tcg_price_upserts,
    ck_scanned: ck_result.scanned,
    ck_upserted_buylist: ck_result.upserted_buylist,
    ck_upserted_sell: ck_result.upserted_sell,
  })
}

#[tauri::command]
fn get_ck_buylist_quotes(
  state: State<'_, AppState>,
  items: Vec<CkQuoteRequestItem>,
) -> Result<Vec<CkQuoteDto>, String> {
  if items.is_empty() {
    return Ok(Vec::new());
  }

  let rows = load_ck_pricelist_items(&state)?;
  let mut by_key: std::collections::HashMap<(String, bool), CkPricelistItem> =
    std::collections::HashMap::new();

  for row in rows {
    let scryfall_id = row.scryfall_id.clone().unwrap_or_default().trim().to_string();
    if scryfall_id.is_empty() {
      continue;
    }
    let is_foil = parse_ck_bool(row.is_foil.as_deref());
    by_key.insert((scryfall_id, is_foil), row);
  }

  let mut quotes = Vec::new();
  for item in items {
    let scryfall_id = item.scryfall_id.trim().to_string();
    if scryfall_id.is_empty() {
      continue;
    }
    let nonfoil_qty = item.quantity.max(0);
    let foil_qty = item.foil_quantity.max(0);
    let total_qty = nonfoil_qty + foil_qty;
    if total_qty <= 0 {
      continue;
    }

    let nonfoil = by_key.get(&(scryfall_id.clone(), false));
    let foil = by_key
      .get(&(scryfall_id.clone(), true))
      .or(nonfoil);

    let mut weighted_cash_total = 0.0_f64;
    let mut weighted_qty = 0_i64;
    let mut qty_cap = 0_i64;
    let mut source_url = "https://www.cardkingdom.com/".to_string();

    if let Some(row) = nonfoil {
      let cash = parse_ck_price(row.price_buy.as_deref()).max(0.0);
      if cash > 0.0 && nonfoil_qty > 0 {
        weighted_cash_total += cash * nonfoil_qty as f64;
        weighted_qty += nonfoil_qty;
      }
      qty_cap += row.qty_buying.unwrap_or(0).max(0);
      source_url = make_ck_source_url(row.url.as_deref());
    }

    if let Some(row) = foil {
      let cash = parse_ck_price(row.price_buy.as_deref()).max(0.0);
      if cash > 0.0 && foil_qty > 0 {
        weighted_cash_total += cash * foil_qty as f64;
        weighted_qty += foil_qty;
      }
      qty_cap += row.qty_buying.unwrap_or(0).max(0);
      if source_url == "https://www.cardkingdom.com/" {
        source_url = make_ck_source_url(row.url.as_deref());
      }
    }

    if weighted_qty <= 0 {
      continue;
    }

    // Weighted average handles mixed foil/nonfoil quantities in one aggregated quote row.
    let cash_price = (weighted_cash_total / weighted_qty as f64 * 100.0).round() / 100.0;
    let credit_price = (cash_price * 1.30 * 100.0).round() / 100.0;
    quotes.push(CkQuoteDto {
      scryfall_id,
      name: item.name,
      quantity: total_qty,
      cash_price,
      credit_price,
      qty_cap: qty_cap.max(total_qty),
      source_url,
    });
  }

  Ok(quotes)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      let app_data_dir = app.path().app_data_dir()?;
      let db_path = app_data_dir.join("magiccollection.db");
      init_database(&db_path)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
      app.manage(AppState { db_path, app_data_dir });

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      list_profiles,
      create_profile,
      get_collection,
      add_card_to_collection,
      update_card_quantity,
      remove_card_from_collection,
      remove_cards_from_collection,
      import_collection_rows,
      hydrate_profile_card_metadata,
      bulk_update_tags,
      update_owned_card_metadata,
      set_owned_card_state,
      get_catalog_sync_state,
      get_catalog_price_records,
      apply_catalog_snapshot,
      apply_catalog_patch,
      reset_catalog_sync_state_for_test,
      optimize_catalog_storage,
      sync_filter_tokens,
      get_filter_tokens,
      record_market_snapshots,
      get_market_price_trends,
      get_collection_price_trends_by_source,
      sync_all_sources_now,
      sync_ck_prices_into_card_data,
      get_ck_buylist_quotes
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
