export const API_BASE = '/v1';

export const ENDPOINTS = {
  health: `${API_BASE}/health`,
  pair: `${API_BASE}/pair`,
  device: `${API_BASE}/device`,
  rootsAvailable: `${API_BASE}/roots/available`,
  rootsRegister: `${API_BASE}/roots/register`,
  rootsUnbind: `${API_BASE}/roots/unbind`,
  filesPrepare: `${API_BASE}/files/prepare`,
  filesDelete: `${API_BASE}/files/delete`,
  filesList: `${API_BASE}/files/list`,
  syncStatus: `${API_BASE}/sync/status`,
  uploads: `${API_BASE}/uploads`,
} as const;

// Parameterised routes for the remote gallery (spec 25.2, 6.6). The Fastify route
// templates (`:fileId`) are registered on the desktop; the concrete-url helpers build the
// path the phone requests. Binary responses, so they carry no JSON schema.
export const FILES_THUMBNAIL_ROUTE = `${API_BASE}/files/:fileId/thumbnail`;
export const FILES_CONTENT_ROUTE = `${API_BASE}/files/:fileId/content`;

export function filesPrepareStatusEndpoint(prepareId: string): string {
  return `${ENDPOINTS.filesPrepare}/${prepareId}`;
}

export function fileThumbnailEndpoint(fileId: string): string {
  return `${API_BASE}/files/${fileId}/thumbnail`;
}

export function fileContentEndpoint(fileId: string): string {
  return `${API_BASE}/files/${fileId}/content`;
}
