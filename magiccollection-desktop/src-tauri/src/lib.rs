use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use tauri::{Manager, State};
use uuid::Uuid;

const MIGRATION_SQL_0001: &str = include_str!("../migrations/0001_initial.sql");
const MIGRATION_SQL_0002: &str = include_str!("../migrations/0002_catalog_sync.sql");
const CATALOG_DATASET_DEFAULT: &str = "default_cards";

#[derive(Clone)]
struct AppState {
  db_path: PathBuf,
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
  quantity: i64,
  foil_quantity: i64,
  updated_at: String,
  tags: Vec<String>,
  current_price: Option<f64>,
  previous_price: Option<f64>,
  price_delta: Option<f64>,
  price_direction: String,
  last_price_at: Option<String>,
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
struct BulkUpdateTagsInput {
  profile_id: String,
  scryfall_ids: Vec<String>,
  tags: Vec<String>,
  include_auto_rules: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportCollectionRowInput {
  scryfall_id: String,
  name: String,
  set_code: String,
  collector_number: String,
  image_url: Option<String>,
  quantity: i64,
  foil_quantity: i64,
  tags: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportCollectionInput {
  profile_id: String,
  rows: Vec<ImportCollectionRowInput>,
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

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CatalogPriceRecordDto {
  scryfall_id: String,
  name: String,
  set_code: String,
  collector_number: String,
  image_url: Option<String>,
  market_price: f64,
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
    .execute_batch(MIGRATION_SQL_0001)
    .map_err(|e| e.to_string())?;
  connection
    .execute_batch(MIGRATION_SQL_0002)
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

fn read_catalog_sync_row(
  connection: &Connection,
  dataset: &str,
) -> Result<(Option<String>, Option<String>, Option<String>), String> {
  let state = connection
    .query_row(
      "SELECT current_version, state_hash, synced_at
       FROM catalog_sync_state
       WHERE dataset = ?1
       LIMIT 1",
      params![dataset],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  Ok(state.unwrap_or((None, None, None)))
}

fn count_catalog_records(connection: &Connection) -> Result<i64, String> {
  connection
    .query_row("SELECT COUNT(*) FROM catalog_cards", [], |row| row.get(0))
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
      "INSERT INTO catalog_sync_state (dataset, current_version, state_hash, synced_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT(dataset) DO UPDATE SET
         current_version = excluded.current_version,
         state_hash = excluded.state_hash,
         synced_at = excluded.synced_at,
         updated_at = excluded.updated_at",
      params![dataset, current_version, state_hash, now],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

fn upsert_catalog_record(connection: &Connection, row: &CatalogPriceRecordDto) -> Result<(), String> {
  let normalized_set = row.set_code.trim().to_lowercase();
  let normalized_number = row.collector_number.trim().to_string();
  let normalized_name = row.name.trim().to_string();

  if row.scryfall_id.trim().is_empty() {
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
      "INSERT INTO catalog_cards (
          scryfall_id, name, set_code, collector_number, image_url, market_price, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(scryfall_id) DO UPDATE SET
          name = excluded.name,
          set_code = excluded.set_code,
          collector_number = excluded.collector_number,
          image_url = excluded.image_url,
          market_price = excluded.market_price,
          updated_at = excluded.updated_at",
      params![
        row.scryfall_id.trim(),
        normalized_name,
        normalized_set,
        normalized_number,
        row.image_url.as_deref(),
        row.market_price,
        row.updated_at
      ],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

fn compute_catalog_state_hash(connection: &Connection, dataset: &str) -> Result<String, String> {
  let mut statement = connection
    .prepare(
      "SELECT scryfall_id, name, set_code, collector_number, COALESCE(image_url, ''), market_price, updated_at
       FROM catalog_cards
       ORDER BY scryfall_id",
    )
    .map_err(|e| e.to_string())?;

  let mut rows = statement.query([]).map_err(|e| e.to_string())?;
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
  connection
    .execute(
      "INSERT INTO catalog_patch_history (
         id, dataset, from_version, to_version, strategy, patch_hash,
         added_count, updated_count, removed_count, total_records, applied_at
       )
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
      params![
        Uuid::new_v4().to_string(),
        dataset,
        from_version,
        to_version,
        strategy,
        patch_hash,
        added_count,
        updated_count,
        removed_count,
        total_records,
        now_iso()
      ],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

fn load_catalog_sync_state(connection: &Connection, dataset: &str) -> Result<CatalogSyncStateDto, String> {
  let (current_version, state_hash, synced_at) = read_catalog_sync_row(connection, dataset)?;
  let total_records = count_catalog_records(connection)?;
  Ok(CatalogSyncStateDto {
    dataset: dataset.to_string(),
    current_version,
    state_hash,
    synced_at,
    total_records,
  })
}

fn ensure_profile_exists(connection: &Connection, profile_id: &str) -> Result<(), String> {
  let exists: Option<String> = connection
    .query_row(
      "SELECT id FROM profiles WHERE id = ?1 LIMIT 1",
      params![profile_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  if exists.is_none() {
    return Err(format!("Profile not found: {}", profile_id));
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
) -> Result<(), String> {
  let now = now_iso();
  let normalized_set = set_code.trim().to_lowercase();
  let set_name = if normalized_set.is_empty() {
    "unknown".to_string()
  } else {
    normalized_set.to_uppercase()
  };

  connection
    .execute(
      "INSERT INTO cards (id, oracle_id, name, created_at, updated_at)
       VALUES (?1, NULL, ?2, ?3, ?3)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         updated_at = excluded.updated_at",
      params![scryfall_id, name.trim(), now],
    )
    .map_err(|e| e.to_string())?;

  connection
    .execute(
      "INSERT INTO printings (
          id, card_id, scryfall_id, set_code, set_name, collector_number,
          rarity, language, is_token, image_normal_url, image_small_url, image_art_crop_url,
          created_at, updated_at
        )
        VALUES (?1, ?1, ?1, ?2, ?3, ?4, NULL, 'en', 0, ?5, ?5, ?5, ?6, ?6)
        ON CONFLICT(id) DO UPDATE SET
          set_code = excluded.set_code,
          set_name = excluded.set_name,
          collector_number = excluded.collector_number,
          image_normal_url = COALESCE(excluded.image_normal_url, printings.image_normal_url),
          image_small_url = COALESCE(excluded.image_small_url, printings.image_small_url),
          image_art_crop_url = COALESCE(excluded.image_art_crop_url, printings.image_art_crop_url),
          updated_at = excluded.updated_at",
      params![
        scryfall_id,
        normalized_set,
        set_name,
        collector_number.trim(),
        image_url,
        now
      ],
    )
    .map_err(|e| e.to_string())?;

  Ok(())
}

fn upsert_tags_for_owned_item(
  connection: &Connection,
  profile_id: &str,
  owned_item_id: &str,
  tags: &[String],
) -> Result<(), String> {
  connection
    .execute(
      "DELETE FROM owned_item_tags WHERE owned_item_id = ?1",
      params![owned_item_id],
    )
    .map_err(|e| e.to_string())?;

  for tag in tags.iter().map(|tag| tag.trim()).filter(|tag| !tag.is_empty()) {
    let existing_tag_id: Option<String> = connection
      .query_row(
        "SELECT id FROM tags WHERE profile_id = ?1 AND lower(name) = lower(?2) LIMIT 1",
        params![profile_id, tag],
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
          "INSERT INTO tags (id, profile_id, name, created_at) VALUES (?1, ?2, ?3, ?4)",
          params![id, profile_id, tag, now_iso()],
        )
        .map_err(|e| e.to_string())?;
      id
    };

    connection
      .execute(
        "INSERT OR IGNORE INTO owned_item_tags (owned_item_id, tag_id, created_at)
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
       FROM owned_item_tags oit
       JOIN tags t ON t.id = oit.tag_id
       WHERE oit.owned_item_id = ?1
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
  let mut statement = connection
    .prepare(
      "SELECT market_price, captured_at
       FROM price_snapshots
       WHERE printing_id = ?1
         AND channel = 'market'
         AND market_price IS NOT NULL
       ORDER BY captured_at DESC
       LIMIT 2",
    )
    .map_err(|e| e.to_string())?;

  let mut rows = statement
    .query(params![scryfall_id])
    .map_err(|e| e.to_string())?;

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

  let previous: Option<f64> = connection
    .query_row(
      "SELECT market_price
       FROM price_snapshots
       WHERE printing_id = ?1
         AND vendor = ?2
         AND channel = ?3
         AND market_price IS NOT NULL
       ORDER BY captured_at DESC
       LIMIT 1",
      params![scryfall_id, vendor, channel],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  if let Some(last) = previous {
    if (last - market_price).abs() < 0.0001 {
      return Ok(());
    }
  }

  let now = now_iso();
  connection
    .execute(
      "INSERT INTO price_snapshots (
        id, printing_id, vendor, channel, currency, condition_code, is_foil,
        market_price, low_price, direct_low_price, source_market_url, captured_at, created_at
      )
      VALUES (?1, ?2, ?3, ?4, 'USD', 'NM', 0, ?5, NULL, NULL, NULL, ?6, ?6)",
      params![
        Uuid::new_v4().to_string(),
        scryfall_id,
        vendor,
        channel,
        market_price,
        now
      ],
    )
    .map_err(|e| e.to_string())?;

  Ok(())
}

fn load_collection_rows(connection: &Connection, profile_id: &str) -> Result<Vec<OwnedCardDto>, String> {
  let mut statement = connection
    .prepare(
      "SELECT
         oi.id,
         p.scryfall_id,
         c.name,
         p.set_code,
         p.collector_number,
         p.image_normal_url,
         oi.quantity,
         oi.foil_quantity,
         oi.updated_at
       FROM owned_items oi
       JOIN printings p ON p.id = oi.printing_id
       JOIN cards c ON c.id = p.card_id
       WHERE oi.profile_id = ?1
         AND (oi.quantity > 0 OR oi.foil_quantity > 0)
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
        row.get::<usize, i64>(6)?,
        row.get::<usize, i64>(7)?,
        row.get::<usize, String>(8)?,
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
      quantity,
      foil_quantity,
      updated_at,
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
      quantity,
      foil_quantity,
      updated_at,
      tags,
      current_price: trend.current_price,
      previous_price: trend.previous_price,
      price_delta: trend.price_delta,
      price_direction: trend.price_direction,
      last_price_at: trend.last_price_at,
    });
  }

  Ok(cards)
}

#[tauri::command]
fn list_profiles(state: State<'_, AppState>) -> Result<Vec<ProfileDto>, String> {
  let connection = open_database(&state.db_path)?;
  let mut statement = connection
    .prepare("SELECT id, name, created_at FROM profiles ORDER BY name COLLATE NOCASE")
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
      "SELECT id, name, created_at
       FROM profiles
       WHERE lower(name) = lower(?1)
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
      "INSERT INTO profiles (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
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
  ensure_card_and_printing(
    &connection,
    &input.scryfall_id,
    &input.name,
    &input.set_code,
    &input.collector_number,
    input.image_url.as_deref(),
  )?;

  let existing: Option<(String, i64, i64)> = connection
    .query_row(
      "SELECT id, quantity, foil_quantity
       FROM owned_items
       WHERE profile_id = ?1
         AND printing_id = ?2
         AND condition_code = 'NM'
         AND language = 'en'
         AND location_id IS NULL
       LIMIT 1",
      params![input.profile_id, input.scryfall_id],
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
        "UPDATE owned_items
         SET quantity = ?1, foil_quantity = ?2, updated_at = ?3
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
        "INSERT INTO owned_items (
           id, profile_id, printing_id, quantity, foil_quantity, condition_code, language,
           purchase_price, date_added, location_id, notes, created_at, updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, 'NM', 'en', NULL, ?6, NULL, NULL, ?6, ?6)",
        params![
          id,
          input.profile_id,
          input.scryfall_id,
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
    maybe_insert_market_snapshot(&connection, &input.scryfall_id, price, "scryfall", "market")?;
  }

  load_collection_rows(&connection, &input.profile_id)
}

#[tauri::command]
fn update_card_quantity(
  state: State<'_, AppState>,
  input: QuantityInput,
) -> Result<Vec<OwnedCardDto>, String> {
  let connection = open_database(&state.db_path)?;
  ensure_profile_exists(&connection, &input.profile_id)?;

  let existing: Option<(String, i64, i64)> = connection
    .query_row(
      "SELECT id, quantity, foil_quantity
       FROM owned_items
       WHERE profile_id = ?1
         AND printing_id = ?2
         AND condition_code = 'NM'
         AND language = 'en'
         AND location_id IS NULL
       LIMIT 1",
      params![input.profile_id, input.scryfall_id],
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
        .execute("DELETE FROM owned_items WHERE id = ?1", params![owned_item_id])
        .map_err(|e| e.to_string())?;
    } else {
      connection
        .execute(
          "UPDATE owned_items
           SET quantity = ?1, foil_quantity = ?2, updated_at = ?3
           WHERE id = ?4",
          params![next_quantity, next_foil_quantity, now_iso(), owned_item_id],
        )
        .map_err(|e| e.to_string())?;
    }
  }

  load_collection_rows(&connection, &input.profile_id)
}

#[tauri::command]
fn remove_card_from_collection(
  state: State<'_, AppState>,
  input: RemoveCardInput,
) -> Result<Vec<OwnedCardDto>, String> {
  let connection = open_database(&state.db_path)?;
  ensure_profile_exists(&connection, &input.profile_id)?;

  connection
    .execute(
      "DELETE FROM owned_items WHERE profile_id = ?1 AND printing_id = ?2",
      params![input.profile_id, input.scryfall_id],
    )
    .map_err(|e| e.to_string())?;

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
      let quantity = row.quantity.max(0);
      let foil_quantity = row.foil_quantity.max(0);
      if quantity + foil_quantity <= 0 {
        continue;
      }

      ensure_card_and_printing(
        &tx,
        &row.scryfall_id,
        &row.name,
        &row.set_code,
        &row.collector_number,
        row.image_url.as_deref(),
      )?;

      let existing: Option<(String, i64, i64)> = tx
        .query_row(
          "SELECT id, quantity, foil_quantity
           FROM owned_items
           WHERE profile_id = ?1
             AND printing_id = ?2
             AND condition_code = 'NM'
             AND language = 'en'
             AND location_id IS NULL
           LIMIT 1",
          params![&input.profile_id, &row.scryfall_id],
          |db_row| Ok((db_row.get(0)?, db_row.get(1)?, db_row.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

      let now = now_iso();
      let owned_item_id = if let Some((owned_item_id, current_qty, current_foil_qty)) = existing {
        let next_qty = current_qty + quantity;
        let next_foil_qty = current_foil_qty + foil_quantity;
        tx.execute(
          "UPDATE owned_items
           SET quantity = ?1, foil_quantity = ?2, updated_at = ?3
           WHERE id = ?4",
          params![next_qty, next_foil_qty, now, owned_item_id],
        )
        .map_err(|e| e.to_string())?;
        owned_item_id
      } else {
        let owned_item_id = Uuid::new_v4().to_string();
        tx.execute(
          "INSERT INTO owned_items (
             id, profile_id, printing_id, quantity, foil_quantity, condition_code, language,
             purchase_price, date_added, location_id, notes, created_at, updated_at
           )
           VALUES (?1, ?2, ?3, ?4, ?5, 'NM', 'en', NULL, ?6, NULL, NULL, ?6, ?6)",
          params![
            owned_item_id,
            &input.profile_id,
            &row.scryfall_id,
            quantity,
            foil_quantity,
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

  load_collection_rows(&connection, &input.profile_id)
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
      let found: Option<(String, i64, i64)> = tx
        .query_row(
          "SELECT id, quantity, foil_quantity
           FROM owned_items
           WHERE profile_id = ?1
             AND printing_id = ?2
             AND condition_code = 'NM'
             AND language = 'en'
             AND location_id IS NULL
           LIMIT 1",
          params![&input.profile_id, &scryfall_id],
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
  let _normalized_dataset = normalize_catalog_dataset(dataset.as_deref())?;

  if scryfall_ids.is_empty() {
    return Ok(Vec::new());
  }

  let mut statement = connection
    .prepare(
      "SELECT scryfall_id, name, set_code, collector_number, image_url, market_price, updated_at
       FROM catalog_cards
       WHERE scryfall_id = ?1
       LIMIT 1",
    )
    .map_err(|e| e.to_string())?;

  let mut rows_out = Vec::new();
  for scryfall_id in scryfall_ids {
    let found = statement
      .query_row(params![scryfall_id], |row| {
        Ok(CatalogPriceRecordDto {
          scryfall_id: row.get(0)?,
          name: row.get(1)?,
          set_code: row.get(2)?,
          collector_number: row.get(3)?,
          image_url: row.get(4)?,
          market_price: row.get(5)?,
          updated_at: row.get(6)?,
        })
      })
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

  tx.execute("DELETE FROM catalog_cards", [])
    .map_err(|e| e.to_string())?;
  for row in input.records.iter() {
    upsert_catalog_record(&tx, row)?;
  }

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
  let total_records = count_catalog_records(&tx)?;
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

  for scryfall_id in input.removed.iter().map(|id| id.trim()).filter(|id| !id.is_empty()) {
    tx.execute(
      "DELETE FROM catalog_cards WHERE scryfall_id = ?1",
      params![scryfall_id],
    )
    .map_err(|e| e.to_string())?;
  }

  for row in input.added.iter() {
    upsert_catalog_record(&tx, row)?;
  }
  for row in input.updated.iter() {
    upsert_catalog_record(&tx, row)?;
  }

  let computed_state_hash = compute_catalog_state_hash(&tx, &normalized_dataset)?;
  write_catalog_sync_state(
    &tx,
    &normalized_dataset,
    Some(&to_version),
    Some(&computed_state_hash),
  )?;
  let total_records = count_catalog_records(&tx)?;
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

  tx.execute("DELETE FROM catalog_cards", [])
    .map_err(|e| e.to_string())?;
  tx.execute(
    "DELETE FROM catalog_sync_state WHERE dataset = ?1",
    params![&normalized_dataset],
  )
  .map_err(|e| e.to_string())?;
  tx.execute(
    "DELETE FROM catalog_patch_history WHERE dataset = ?1",
    params![&normalized_dataset],
  )
  .map_err(|e| e.to_string())?;

  tx.commit().map_err(|e| e.to_string())?;
  let connection = open_database(&state.db_path)?;
  load_catalog_sync_state(&connection, &normalized_dataset)
}

#[tauri::command]
fn record_market_snapshots(
  state: State<'_, AppState>,
  snapshots: Vec<MarketSnapshotInput>,
) -> Result<(), String> {
  let connection = open_database(&state.db_path)?;

  for snapshot in snapshots {
    ensure_card_and_printing(
      &connection,
      &snapshot.scryfall_id,
      &snapshot.name,
      &snapshot.set_code,
      &snapshot.collector_number,
      snapshot.image_url.as_deref(),
    )?;

    if let Some(price) = snapshot.market_price {
      maybe_insert_market_snapshot(&connection, &snapshot.scryfall_id, price, "scryfall", "market")?;
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
    let trend = build_price_trend(&connection, &scryfall_id)?;
    trends.push(MarketTrendDto {
      scryfall_id,
      current_price: trend.current_price,
      previous_price: trend.previous_price,
      price_delta: trend.price_delta,
      price_direction: trend.price_direction,
      last_price_at: trend.last_price_at,
    });
  }

  Ok(trends)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      let app_data_dir = app.path().app_data_dir()?;
      let db_path = app_data_dir.join("magiccollection.db");
      init_database(&db_path)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
      app.manage(AppState { db_path });

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
      import_collection_rows,
      bulk_update_tags,
      get_catalog_sync_state,
      get_catalog_price_records,
      apply_catalog_snapshot,
      apply_catalog_patch,
      reset_catalog_sync_state_for_test,
      record_market_snapshots,
      get_market_price_trends
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
