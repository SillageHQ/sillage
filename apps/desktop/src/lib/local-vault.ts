import { invoke } from "@tauri-apps/api/core";

export type LocalVaultNote = {
  title: string;
  path: string;
  folder: string;
  modifiedAt: string;
};

export type LocalVaultTree = {
  items: LocalVaultNote[];
  folders: string[];
};

export type LocalVaultNoteContent = {
  content: string;
  body: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  bodyStartOffset: number;
  contentHash: string;
};

export function listLocalVaultNotes(vaultPath: string, query = "") {
  return invoke<LocalVaultTree>("list_vault_notes", {
    vaultPath,
    query: query || null,
  });
}

export function readLocalVaultNote(vaultPath: string, notePath: string) {
  return invoke<LocalVaultNoteContent>("read_vault_note", {
    vaultPath,
    notePath,
  });
}
