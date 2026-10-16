import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

export type User = { phone: string; name: string; city: string; height: number; weight: number; waist?: number; body_shape: string; email?: string; tags?: string[] };
export type Item = { id: string; name: string; price: number; img: string };
export type Outfit = { id: string; title: string; occasion: string; match: number; likes: number; cover: string; tags: string[]; items: Item[] };
export type Comment = { user: string; text: string; likes?: number };
export type Post = { id: string; title: string; cover: string; bodyTag: string; author: { name: string; avatar: string }; likes: number; comments: Comment[] };
export type WardrobeItem = { id: string; name: string; category: string; image_url?: string; color: string; wear_count: number };
export type Plan = { id: string; name: string; days: number; price: number; note: string };
export type Order = { id: string; plan_name: string; price: number; renewal: boolean; expires_at: string; created_at: string; message: string };
export type Catalog = { outfits: Outfit[]; posts: Post[]; occasions: string[]; cats: string[]; membershipPlans: Plan[]; membershipBenefits: { icon: string; title: string; detail: string }[]; poll: { question: string; endsIn: string; options: { id: string; label: string; sub: string; img: string; count: number }[] }; reviews: { img: string; height: number; weight: number; size: string; fit: string; note: string }[] };
export type State = { likes: string[]; adopted: string[]; comments: Record<string, Comment[]>; vote: string | null; settings: { weather: boolean; notify: boolean; recommendation: string }; member_until: string | null; orders: Order[] };
type Session = { token: string; user: User };
const metroHost = Constants.expoConfig?.hostUri?.split(':')[0];
const host = Platform.OS === 'web' ? (typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1') : metroHost || '127.0.0.1';
export const API_BASE = (process.env.EXPO_PUBLIC_API_URL || `http://${host}:8000`).replace(/\/$/, '');
export const asset = (url?: string) => url ? new URL(url, `${API_BASE}/`).toString() : undefined;
let token = '';
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `请求失败（${response.status}），请检查输入后重试`);
  return data as T;
}
export const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
type Store = { user: User | null; catalog: Catalog | null; state: State | null; wardrobe: WardrobeItem[]; ready: boolean; busy: boolean; message: string; dismiss: () => void; refresh: () => Promise<void>; login: (phone: string, code: string) => Promise<void>; logout: () => Promise<void>; mutate: (path: string, options?: RequestInit) => Promise<boolean>; owned: (name: string) => boolean; notify: (message: string) => void };
const Context = createContext<Store | null>(null);
export function Provider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, notify] = useState('');
  const load = useCallback(async (phone: string) => {
    const q = `phone=${encodeURIComponent(phone)}`;
    const [profile, cat, current, closet] = await Promise.all([request<User>(`/api/user/profile?${q}`), request<Catalog>('/api/catalog'), request<State>(`/api/state?${q}`), request<{ items: WardrobeItem[] }>(`/api/wardrobe?${q}`)]);
    setUser(profile); setCatalog(cat); setState(current); setWardrobe(closet.items);
  }, []);
  useEffect(() => { void (async () => { try { const saved = await AsyncStorage.getItem('shanyi_session'); if (saved) { const session = JSON.parse(saved) as Session; if (session.token && session.user?.phone) { token = session.token; await load(session.user.phone); } } } catch (error) { token = ''; await AsyncStorage.removeItem('shanyi_session').catch(() => undefined); notify(`登录状态已失效：${(error as Error).message}`); } finally { setReady(true); } })(); }, [load]);
  const refresh = async () => { if (user) await load(user.phone); };
  const login = async (phone: string, code: string) => { if (busy) return; setBusy(true); try { const session = await request<Session>('/api/auth/verify', json({ phone, code })); token = session.token; await load(session.user.phone); await AsyncStorage.setItem('shanyi_session', JSON.stringify(session)); } catch (error) { token = ''; setUser(null); setCatalog(null); setState(null); setWardrobe([]); throw error; } finally { setBusy(false); } };
  const logout = async () => { await AsyncStorage.removeItem('shanyi_session'); token = ''; setUser(null); setCatalog(null); setState(null); setWardrobe([]); };
  const mutate = async (path: string, options: RequestInit = { method: 'POST' }) => { if (!user || busy) return false; setBusy(true); try { await request(`${path}${path.includes('?') ? '&' : '?'}phone=${encodeURIComponent(user.phone)}`, options); await load(user.phone); return true; } catch (error) { notify((error as Error).message); return false; } finally { setBusy(false); } };
  return <Context.Provider value={{ user, catalog, state, wardrobe, ready, busy, message, dismiss: () => notify(''), refresh, login, logout, mutate, owned: name => wardrobe.some(item => item.name === name), notify }}>{children}</Context.Provider>;
}
export function useStore() { const value = useContext(Context); if (!value) throw new Error('缺少应用数据上下文'); return value; }
