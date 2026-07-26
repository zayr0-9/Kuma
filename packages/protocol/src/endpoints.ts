export const API_BASE = '/v1';

export const ENDPOINTS = {
  health: `${API_BASE}/health`,
  pair: `${API_BASE}/pair`,
  device: `${API_BASE}/device`,
  rootsAvailable: `${API_BASE}/roots/available`,
  rootsRegister: `${API_BASE}/roots/register`,
  filesPrepare: `${API_BASE}/files/prepare`,
  filesDelete: `${API_BASE}/files/delete`,
  syncStatus: `${API_BASE}/sync/status`,
  uploads: `${API_BASE}/uploads`,
} as const;

export function filesPrepareStatusEndpoint(prepareId: string): string {
  return `${ENDPOINTS.filesPrepare}/${prepareId}`;
}
