use crate::state::appstate::AppState;
use crate::state::document::{request, DocOp};
use crate::state::ws_state::WsState;
use crdt_core::wire::{encode_presence, PresenceFrame};
use log::debug;
use tauri::State;

/// Broadcasts this client's cursor/selection to peers. Best-effort: presence
/// is ephemeral, so "not connected" and send failures are quietly ignored
/// rather than surfaced as errors (the next cursor move re-sends anyway).
#[tauri::command]
pub async fn send_cursor(
    sel_start: u32,
    sel_end: u32,
    state: State<'_, AppState>,
    ws: State<'_, WsState>,
) -> Result<(), String> {
    let client_id = request(&state.doc_tx, |reply| DocOp::GetClientId { reply })
        .await
        .map_err(|e| format!("send_cursor: failed to read local client id: {e}"))?;

    let frame = encode_presence(&PresenceFrame {
        client_id,
        sel_start,
        sel_end,
    });
    if let Err(e) = ws.send_raw(frame).await {
        debug!("send_cursor: presence frame dropped: {e}");
    }
    Ok(())
}
