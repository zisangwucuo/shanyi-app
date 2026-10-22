import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

export type Gender = 'male' | 'female' | 'unspecified';
export type OutfitPreference = 'auto' | 'male' | 'female' | 'unisex' | 'all';
export type Audience = 'male' | 'female' | 'unisex';
export type User = { phone: string; name: string; city: string; height: number; weight: number; waist?: number; body_shape: string; email?: string; tags?: string[]; gender: Gender; outfit_preference: OutfitPreference };
export type Item = { id: string; name: string; price: number; img: string };
export type Outfit = { id: string; audience: Audience; title: string; occasion: string; style?: string; season?: string; match: number; likes: number; cover: string; tags: string[]; items: Item[]; summary?: string; styling?: string[]; occasionTip?: string };
export type WardrobeSample = Omit<WardrobeItem, 'wear_count'> & { audience: Audience };
export type Comment = { user: string; text: string; likes?: number };
export type Post = { id: string; title: string; cover: string; bodyTag: string; author: { name: string; avatar: string }; likes: number; comments: Comment[]; excerpt?: string; body?: string[]; tips?: string[]; outfitId?: string };
export type WardrobeItem = { id: string; name: string; category: string; image_url?: string | null; color: string; season: string; style: string; wear_count: number };
export function effectiveOutfitPreference(user: Pick<User, 'gender' | 'outfit_preference'> | null | undefined): Exclude<OutfitPreference, 'auto'> {
  const preference = user?.outfit_preference || 'auto';
  if (preference !== 'auto') return preference;
  return user?.gender === 'male' || user?.gender === 'female' ? user.gender : 'all';
}
export function filterByAudience<T extends { audience?: Audience }>(items: T[], user: Pick<User, 'gender' | 'outfit_preference'> | null | undefined): T[] {
  const preference = effectiveOutfitPreference(user);
  if (preference === 'all') return items;
  const allowed: Audience[] = preference === 'male' ? ['male', 'unisex'] : preference === 'female' ? ['female', 'unisex'] : ['unisex'];
  return items.filter(item => allowed.includes(item.audience || 'female'));
}
export type Recommendation = { outfit: Outfit; matched: { item: Item; wardrobe_item: WardrobeItem; reason: string; exact_color: boolean }[]; missing: { item: Item; reason: string }[]; owned_count: number; total_count: number; coverage: number; reason: string };
export type Plan = { id: string; name: string; days: number; price: number; note: string };
export type Order = { id: string; plan_name: string; price: number; renewal: boolean; expires_at: string; created_at: string; message: string };
export type Catalog = { wardrobeSamples?: WardrobeSample[]; categoryGroups?: Record<string, string[]>; outfits: Outfit[]; posts: Post[]; occasions: string[]; cats: string[]; membershipPlans: Plan[]; membershipBenefits: { icon: string; title: string; detail: string }[]; poll: { question: string; endsIn: string; options: { id: string; label: string; sub: string; img: string; count: number }[] }; reviews: { img: string; height: number; weight: number; size: string; fit: string; note: string }[] };
export type State = { likes: string[]; adopted: string[]; comments: Record<string, Comment[]>; vote: string | null; settings: { weather: boolean; notify: boolean; recommendation: string }; member_until: string | null; orders: Order[] };
export type WearRecord = { id: string; date: string; outfit_id: string; outfit: Outfit; items: WardrobeItem[]; missing: string[] };
export type Activity = { today: string; records: WearRecord[]; feedback: Record<string, 'like' | 'dislike'> };
const emptyActivity: Activity = { today: '', records: [], feedback: {} };
type Session = { token: string; phone: string; expires_at?: string };
type IssuedSession = { token: string; user: User; expires_at: string };
const metroHost = Constants.expoConfig?.hostUri?.split(':')[0];
const host = Platform.OS === 'web' ? (typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1') : metroHost || '127.0.0.1';
const configuredApi = process.env.EXPO_PUBLIC_API_URL?.trim();
if (!__DEV__ && (!configuredApi || !/^https:\/\//i.test(configuredApi))) throw new Error('发布版本必须配置 HTTPS 的 EXPO_PUBLIC_API_URL');
export const API_BASE: string = (configuredApi || `http://${host}:8000`).replace(/\/$/, '');
export const asset = (url?: string) => url ? new URL(url, `${API_BASE}/`).toString() : undefined;
const sessionKey = `shanyi_session_v2_${Array.from(API_BASE).map(char => char.charCodeAt(0).toString(16).padStart(4, '0')).join('')}`;
const migrationKey = 'shanyi_session_migrated_v2';
const sessionStorage = {
  get: () => Platform.OS === 'web' ? AsyncStorage.getItem(sessionKey) : SecureStore.getItemAsync(sessionKey),
  set: (value: string) => Platform.OS === 'web' ? AsyncStorage.setItem(sessionKey, value) : SecureStore.setItemAsync(sessionKey, value),
  clear: () => Platform.OS === 'web' ? AsyncStorage.removeItem(sessionKey) : SecureStore.deleteItemAsync(sessionKey),
};
function parseSession(raw: string): Session {
  const value = JSON.parse(raw);
  const phone = value?.phone ?? value?.user?.phone;
  if (!value || typeof value.token !== 'string' || !value.token.trim() || value.token.length > 1024 || typeof phone !== 'string' || !/^1\d{10}$/.test(phone) || (value.expires_at !== undefined && (typeof value.expires_at !== 'string' || !Number.isFinite(Date.parse(value.expires_at))))) throw new Error('本地登录信息无效，请重新登录');
  return { token: value.token, phone, ...(value.expires_at ? { expires_at: value.expires_at } : {}) };
}
let token = '';
let onUnauthorized: ((requestToken: string) => void) | undefined;
export class ApiError extends Error {
  constructor(message: string, public kind: 'timeout' | 'network' | 'http' | 'response', public status?: number, public retryAfter?: number) { super(message); this.name = 'ApiError'; }
}
export async function request<T>(path: string, options: RequestInit = {}, timeoutMs = 30000): Promise<T> {
  const requestToken = token;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort);
  if (options.signal?.aborted) controller.abort();
  try {
    const headers = new Headers(options.headers);
    if (requestToken) headers.set('Authorization', `Bearer ${requestToken}`);
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: controller.signal });
    if (response.status === 401 && requestToken && token === requestToken) onUnauthorized?.(requestToken);
    const text = await response.text();
    let data: Record<string, unknown> | undefined;
    try { data = text ? JSON.parse(text) : undefined; } catch { /* HTTP status remains available even for non-JSON errors. */ }
    if (!response.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : response.status >= 500 ? '服务暂时不可用，请稍后重试' : `请求失败（${response.status}），请检查后重试`;
      const retry = Number(response.headers.get('Retry-After'));
      throw new ApiError(detail, 'http', response.status, retry > 0 ? retry : undefined);
    }
    if (text && data === undefined) throw new ApiError('服务器返回的数据无法读取，请重试', 'response', response.status);
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(timedOut ? '请求超时，请检查网络后重试；提交操作请先刷新确认结果' : controller.signal.aborted ? '请求已取消' : '无法连接服务器，请检查网络后重试；提交操作请先刷新确认结果', timedOut ? 'timeout' : 'network');
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
export const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export type SavedSet = { id: string; name: string; items: WardrobeItem[]; created_at: string; post_id?: string | null; author?: string };
type Store = { savedSets: SavedSet[]; sharedSets: SavedSet[]; activity: Activity; user: User | null; catalog: Catalog | null; state: State | null; wardrobe: WardrobeItem[]; recommendations: Recommendation[]; ready: boolean; busy: boolean; message: string; messageId: number; messagePersistent: boolean; loadError: string; recovery: boolean; dismiss: () => void; refresh: () => Promise<void>; login: (phone: string, code: string) => Promise<void>; logout: (localOnly?: boolean) => Promise<void>; mutate: (path: string, options?: RequestInit) => Promise<boolean>; owned: (name: string) => boolean; notify: (message: string, persistent?: boolean) => void };
const Context = createContext<Store | null>(null);
export function Provider({ children }: { children: ReactNode }) {
  const [savedSets, setSavedSets] = useState<SavedSet[]>([]);
  const [sharedSets, setSharedSets] = useState<SavedSet[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [activity, setActivity] = useState<Activity>(emptyActivity);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageId, setMessageId] = useState(0);
  const [messagePersistent, setMessagePersistent] = useState(false);
  const messageVersion = useRef(0);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismiss = useCallback(() => {
    ++messageVersion.current;
    if (messageTimer.current !== null) clearTimeout(messageTimer.current);
    messageTimer.current = null;
    setMessage(''); setMessagePersistent(false);
  }, []);
  const notify = useCallback((next: string, persistent = false) => {
    if (messageTimer.current !== null) clearTimeout(messageTimer.current);
    messageTimer.current = null;
    setMessage(next);
    setMessagePersistent(persistent);
    setMessageId(++messageVersion.current);
  }, []);
  useEffect(() => {
    if (!message || messagePersistent) return;
    const version = messageId;
    messageTimer.current = setTimeout(() => {
      if (messageVersion.current === version) dismiss();
    }, 3000);
    return () => {
      if (messageTimer.current !== null) clearTimeout(messageTimer.current);
      messageTimer.current = null;
    };
  }, [message, messageId, messagePersistent, dismiss]);
  const [loadError, setLoadError] = useState('');
  const [hasSession, setHasSession] = useState(false);
  const mutationBusy = useRef(false);
  const authBusy = useRef(false);
  const loadVersion = useRef(0);
  const pendingSession = useRef<Session | null>(null);
  const retryStartup = useRef<() => Promise<void>>(async () => undefined);
  const storageQueue = useRef<Promise<unknown>>(Promise.resolve());
  const persist = useCallback((operation: () => Promise<unknown>) => {
    const next = storageQueue.current.catch(() => undefined).then(operation);
    storageQueue.current = next;
    return next;
  }, []);
  const clear = useCallback(() => {
    token = ''; pendingSession.current = null; ++loadVersion.current; setHasSession(false); setUser(null); setCatalog(null); setState(null); setWardrobe([]); setRecommendations([]); setActivity(emptyActivity); setSavedSets([]); setSharedSets([]); setLoadError('');
  }, []);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    const loadingToken = token;
    if (!loadingToken) return;
    try {
      const [profile, cat, current, closet, plans, activityData, sets, posts] = await Promise.all([request<User>('/api/user/profile'), request<Catalog>('/api/catalog'), request<State>('/api/state'), request<{ items: WardrobeItem[] }>('/api/wardrobe'), request<{ items: Recommendation[] }>('/api/recommendations'), request<Activity>('/api/outfit-activity'), request<{ items: SavedSet[] }>('/api/outfit-sets'), request<{ items: SavedSet[] }>('/api/community-sets')]);
      if (token !== loadingToken || version !== loadVersion.current) return;
      setUser(profile); setCatalog(cat); setState(current); setWardrobe(closet.items); setRecommendations(plans.items); setActivity(activityData); setSavedSets(sets.items); setSharedSets(posts.items); setLoadError('');
    } catch (error) {
      if (token === loadingToken && version === loadVersion.current) setLoadError((error as Error).message);
      throw error;
    }
  }, []);
  useEffect(() => {
    let active = true;
    onUnauthorized = requestToken => {
      if (token !== requestToken) return;
      clear(); notify('登录已失效，请重新登录');
      void persist(() => sessionStorage.clear()).catch(() => notify('登录已失效，但本地凭证清理失败，请再次退出'));
    };
    const restoreSession = async () => {
      try {
        let saved = await sessionStorage.get();
        if (!saved && !await AsyncStorage.getItem(migrationKey)) {
          const legacy = await AsyncStorage.getItem('shanyi_session');
          if (legacy) {
            try { const session = parseSession(legacy); saved = JSON.stringify(session); }
            catch (error) { notify((error as Error).message); }
            if (saved) await persist(() => sessionStorage.set(saved!));
          }
          await AsyncStorage.setItem(migrationKey, '1');
          await AsyncStorage.removeItem('shanyi_session');
        }
        if (!active) return;
        if (saved) {
          let session: Session;
          try { session = parseSession(saved); } catch (error) { await persist(() => sessionStorage.clear()); notify((error as Error).message); return; }
          token = session.token; setHasSession(true);
          await load();
        }
      } catch (error) { if (active && !(error instanceof ApiError && error.status === 401)) setLoadError((error as Error).message); }
      finally { if (active) setReady(true); }
    };
    retryStartup.current = restoreSession;
    void restoreSession();
    return () => { active = false; onUnauthorized = undefined; };
  }, [clear, load, persist, notify]);
  const refresh = async () => {
    if (authBusy.current) return;
    setBusy(true);
    try {
      if (!token) { setLoadError(''); await retryStartup.current(); return; }
      const session = pendingSession.current;
      if (session) {
        await persist(() => sessionStorage.set(JSON.stringify(session)));
        if (pendingSession.current === session) pendingSession.current = null;
        if (token !== session.token) return;
      }
      await load();
    } catch (error) { if (token) setLoadError((error as Error).message); throw error; }
    finally { setBusy(false); }
  };
  const login = async (phone: string, code: string) => {
    if (authBusy.current) return;
    authBusy.current = true; setBusy(true);
    try {
      const issued = await request<IssuedSession>('/api/auth/verify', json({ phone, code }));
      const session = parseSession(JSON.stringify(issued));
      token = session.token; pendingSession.current = session; setHasSession(true); setLoadError(''); notify('');
      try { await persist(() => sessionStorage.set(JSON.stringify(session))); pendingSession.current = null; }
      catch { setLoadError('登录已签发，但本地保存失败。请重试恢复，并保持应用开启。'); return; }
      try { await load(); } catch { /* Keep the issued session on the recovery screen. */ }
    } finally { authBusy.current = false; setBusy(false); }
  };
  const logout = async (localOnly = false) => {
    if (authBusy.current) return;
    authBusy.current = true; setBusy(true);
    const currentToken = token;
    try {
      if (!localOnly && currentToken) {
        try { await request('/api/auth/logout', { method: 'POST' }); }
        catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw new Error(`未能撤销登录：${(error as Error).message}。可重试，或选择仅退出此设备。`); }
      }
      if (token && token !== currentToken) return;
      await persist(() => sessionStorage.clear());
      clear(); notify(localOnly ? '已退出此设备；服务器登录未确认撤销，将在到期后失效' : '已退出登录');
    } finally { authBusy.current = false; setBusy(false); }
  };
  const mutate = async (path: string, options: RequestInit = { method: 'POST' }) => {
    if (!user || busy || mutationBusy.current) return false;
    const mutationToken = token;
    mutationBusy.current = true; setBusy(true);
    try {
      await request(path, options);
      if (token !== mutationToken) return false;
      try { await load(); } catch { /* The write succeeded; loadError persists independently of notifications. */ }
      return token === mutationToken;
    } catch (error) { if (token === mutationToken) notify((error as Error).message); return false; }
    finally { mutationBusy.current = false; setBusy(false); }
  };
  return <Context.Provider value={{ savedSets: user ? savedSets : [], sharedSets: user ? sharedSets : [], activity: user ? activity : emptyActivity, user, catalog, state, wardrobe, recommendations: user ? recommendations : [], ready, busy, message, messageId, messagePersistent, loadError, recovery: (hasSession || !!loadError) && !catalog, dismiss, refresh, login, logout, mutate, owned: name => wardrobe.some(item => item.name === name), notify }}>{children}</Context.Provider>;
}
export function useStore() { const value = useContext(Context); if (!value) throw new Error('缺少应用数据上下文'); return value; }
