// One function per endpoint in API_CONTRACT.md sections 3–7.
import { api } from './client';
import type {
  AlertDetail,
  AlertListItem,
  AlertStatus,
  AlertStatusResult,
  AuditEntity,
  AuditRow,
  AuthorisationResponse,
  Card,
  CloseOutcome,
  ConfigEntry,
  ConfigValue,
  Dashboard,
  LoginResponse,
  ManagerDecision,
  MyTransaction,
  PendingStepUp,
  Priority,
  SimulateRequest,
  StepUpResponse,
  StepUpResult,
  User,
} from './types';

// 3. Auth
export const login = (username: string, password: string) =>
  api.post<LoginResponse>('/api/auth/login', { username, password }).then((r) => r.data);
export const getMe = () => api.get<User>('/api/auth/me').then((r) => r.data);

// 4. Cardholder
export const getMyCards = () => api.get<Card[]>('/api/me/cards').then((r) => r.data);
export const getMyTransactions = (card_id?: string, limit = 50) =>
  api
    .get<MyTransaction[]>('/api/me/transactions', { params: { card_id, limit } })
    .then((r) => r.data);
export const getPendingStepUps = () =>
  api.get<PendingStepUp[]>('/api/me/stepups/pending').then((r) => r.data);
export const respondStepUp = (txn_id: string, body: StepUpResponse) =>
  api.post<StepUpResult>(`/api/me/stepups/${txn_id}/respond`, body).then((r) => r.data);
export const blockMyCard = (card_id: string) =>
  api
    .post<{ card_id: string; card_status: 'BLOCKED' }>(`/api/me/cards/${card_id}/block`, {})
    .then((r) => r.data);

// 5. Analyst
export const getAlerts = (filters: { status?: AlertStatus[]; priority?: Priority } = {}) =>
  api
    .get<AlertListItem[]>('/api/alerts', {
      params: {
        status: filters.status?.length ? filters.status.join(',') : undefined,
        priority: filters.priority,
      },
    })
    .then((r) => r.data);
export const getAlert = (id: number | string) =>
  api.get<AlertDetail>(`/api/alerts/${id}`).then((r) => r.data);
export const claimAlert = (id: number) =>
  api.post<AlertDetail['alert']>(`/api/alerts/${id}/claim`, {}).then((r) => r.data);
export const closeAlert = (id: number, outcome: CloseOutcome, comment: string) =>
  api.post<AlertStatusResult>(`/api/alerts/${id}/close`, { outcome, comment }).then((r) => r.data);

// 6. Manager
export const decideAlert = (id: number, decision: ManagerDecision, comment: string) =>
  api
    .post<AlertStatusResult>(`/api/alerts/${id}/decision`, { decision, comment })
    .then((r) => r.data);
export const getDashboard = (from: string, to: string) =>
  api.get<Dashboard>('/api/dashboard', { params: { from, to } }).then((r) => r.data);
export const getAudit = (entity: AuditEntity, entity_id: string) =>
  api.get<AuditRow[]>('/api/audit', { params: { entity, entity_id } }).then((r) => r.data);
export const downloadAuditCsv = async (entity: AuditEntity, entity_id: string) => {
  const res = await api.get<Blob>('/api/audit/export', {
    params: { entity, entity_id },
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit_${entity.toLowerCase()}_${entity_id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
export const getConfig = () => api.get<ConfigEntry[]>('/api/config').then((r) => r.data);
export const putConfig = (key: string, value: ConfigValue) =>
  api
    .put<{ key: string; value: ConfigValue }>(`/api/config/${encodeURIComponent(key)}`, { value })
    .then((r) => r.data);

// 7. Simulate
export const simulate = (body: SimulateRequest) =>
  api.post<AuthorisationResponse>('/api/simulate', body).then((r) => r.data);
