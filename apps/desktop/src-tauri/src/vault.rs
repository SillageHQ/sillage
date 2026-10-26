use chrono::{DateTime, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use walkdir::{DirEntry, WalkDir};

const MAX_NOTES: usize = 2_000;
const MAX_NOTE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultNote {
    title: String,
    path: String,
    folder: String,
    modified_at: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct VaultTree {
    items: Vec<VaultNote>,
    folders: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultNoteContent {
    content: String,
    body: String,
    frontmatter: serde_json::Value,
    tags: Vec<String>,
    body_start_offset: usize,
    content_hash: String,
}

fn visible(entry: &DirEntry, root: &Path) -> bool {
    entry.path() == root || !entry.file_name().to_string_lossy().starts_with('.')
}

fn relative_path(path: &Path, root: &Path) -> Result<String, String> {
    path.strip_prefix(root)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .map_err(|_| "Vault entry is outside the selected folder".to_string())
}

fn canonical_vault(vault_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(vault_path);
    if vault_path.trim().is_empty() || !root.is_dir() {
        return Err("The selected vault folder is unavailable".into());
    }
    root.canonicalize()
        .map_err(|error| format!("Unable to access the selected vault: {error}"))
}

fn markdown_file(entry: &DirEntry) -> bool {
    entry.file_type().is_file()
        && entry
            .path()
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

fn modified_at(entry: &DirEntry) -> String {
    entry
        .metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(DateTime::<Utc>::from)
        .map(|timestamp| timestamp.to_rfc3339())
        .unwrap_or_default()
}

fn read_searchable(path: &Path) -> String {
    let readable = path
        .metadata()
        .is_ok_and(|metadata| metadata.len() <= MAX_NOTE_BYTES);
    if !readable {
        return String::new();
    }
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .to_lowercase()
}

fn list_notes(root: &Path, query: &str) -> Result<VaultTree, String> {
    let query = query.trim().to_lowercase();
    let mut items = Vec::new();
    let mut all_folders = BTreeSet::new();

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| visible(entry, root))
        .filter_map(Result::ok)
    {
        if entry.file_type().is_dir() && entry.path() != root {
            if let Ok(folder) = relative_path(entry.path(), root) {
                all_folders.insert(folder);
            }
            continue;
        }
        if !markdown_file(&entry) {
            continue;
        }
        let path = relative_path(entry.path(), root)?;
        let title = entry
            .path()
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("note")
            .to_string();
        if !query.is_empty()
            && !title.to_lowercase().contains(&query)
            && !path.to_lowercase().contains(&query)
            && !read_searchable(entry.path()).contains(&query)
        {
            continue;
        }
        let folder = Path::new(&path)
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .map(|parent| parent.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        items.push(VaultNote {
            title,
            path,
            folder,
            modified_at: modified_at(&entry),
        });
        if items.len() >= MAX_NOTES {
            break;
        }
    }

    items.sort_by_key(|item| item.path.to_lowercase());
    let folders = if query.is_empty() {
        all_folders.into_iter().collect()
    } else {
        let mut visible_folders = BTreeSet::new();
        for folder in all_folders {
            if folder.to_lowercase().contains(&query) {
                let mut current = Some(Path::new(&folder));
                while let Some(path) = current {
                    if !path.as_os_str().is_empty() {
                        visible_folders.insert(path.to_string_lossy().replace('\\', "/"));
                    }
                    current = path.parent();
                }
            }
        }
        for note in &items {
            let mut current = Some(Path::new(&note.folder));
            while let Some(path) = current {
                if !path.as_os_str().is_empty() {
                    visible_folders.insert(path.to_string_lossy().replace('\\', "/"));
                }
                current = path.parent();
            }
        }
        visible_folders.into_iter().collect()
    };

    Ok(VaultTree { items, folders })
}

fn safe_note_path(root: &Path, note_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(note_path);
    if note_path.trim().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        || !relative
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
    {
        return Err("Invalid vault note path".into());
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "The selected vault folder is unavailable".to_string())?;
    let candidate = canonical_root.join(relative);
    let canonical = candidate
        .canonicalize()
        .map_err(|_| "The selected note is unavailable".to_string())?;
    if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
        return Err("The selected note is unavailable".into());
    }
    Ok(canonical)
}

fn split_frontmatter(content: &str) -> (&str, usize) {
    if !(content.starts_with("---\n") || content.starts_with("---\r\n")) {
        return (content, 0);
    }
    let mut offset = 0;
    for (index, line) in content.split_inclusive('\n').enumerate() {
        offset += line.len();
        if index > 0 && line.trim_end_matches(['\r', '\n']) == "---" {
            return (&content[offset..], offset);
        }
    }
    (content, 0)
}

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn read_note(root: &Path, note_path: &str) -> Result<VaultNoteContent, String> {
    let path = safe_note_path(root, note_path)?;
    if path
        .metadata()
        .is_ok_and(|metadata| metadata.len() > MAX_NOTE_BYTES)
    {
        return Err("The selected note is too large to preview".into());
    }
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("Unable to read the selected note: {error}"))?;
    let (body, body_start_offset) = split_frontmatter(&content);
    let content_hash = format!("{:x}", Sha256::digest(content.as_bytes()));
    Ok(VaultNoteContent {
        body: body.to_string(),
        body_start_offset: utf16_len(&content[..body_start_offset]),
        content,
        frontmatter: serde_json::json!({}),
        tags: Vec::new(),
        content_hash,
    })
}

#[tauri::command]
pub(crate) fn list_vault_notes(
    vault_path: String,
    query: Option<String>,
) -> Result<VaultTree, String> {
    let root = canonical_vault(&vault_path)?;
    list_notes(&root, query.as_deref().unwrap_or_default())
}

#[tauri::command]
pub(crate) fn read_vault_note(
    vault_path: String,
    note_path: String,
) -> Result<VaultNoteContent, String> {
    let root = canonical_vault(&vault_path)?;
    read_note(&root, &note_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_and_reads_local_markdown_notes() {
        let temp = tempfile::tempdir().unwrap();
        let folder = temp.path().join("Knowledge");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(
            folder.join("Example.md"),
            "---\ntags: [test]\n---\n# Example\nLocal vault content",
        )
        .unwrap();
        std::fs::write(temp.path().join(".hidden.md"), "hidden").unwrap();

        let tree = list_vault_notes(
            temp.path().to_string_lossy().into_owned(),
            Some("local vault".into()),
        )
        .unwrap();
        assert_eq!(tree.items.len(), 1);
        assert_eq!(tree.items[0].path, "Knowledge/Example.md");
        assert_eq!(tree.folders, vec!["Knowledge"]);

        let note = read_vault_note(
            temp.path().to_string_lossy().into_owned(),
            "Knowledge/Example.md".into(),
        )
        .unwrap();
        assert_eq!(note.body, "# Example\nLocal vault content");
        assert!(note.body_start_offset > 0);
        assert!(!note.content_hash.is_empty());
    }

    #[test]
    fn rejects_paths_outside_the_vault() {
        let temp = tempfile::tempdir().unwrap();
        assert!(safe_note_path(temp.path(), "../outside.md").is_err());
        assert!(safe_note_path(temp.path(), "/tmp/outside.md").is_err());
    }
}
