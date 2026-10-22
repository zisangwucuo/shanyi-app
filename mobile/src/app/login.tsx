import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, C, Field, s } from '../components/ui';
import { ApiError, request, json, useStore } from '../lib/store';

type Config = { mode: string; resend_seconds: number; expires_in: number };
type CodeResult = { development_code?: string; resend_seconds: number; expires_in: number };
export default function Login() {
  const { login, busy } = useStore();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [config, setConfig] = useState<Config | null>(null);
  const [configError, setConfigError] = useState('');
  const [configLoading, setConfigLoading] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [codes, setCodes] = useState<Record<string, { until: number; developmentCode?: string; expires: number }>>({});
  const [now, setNow] = useState(() => Date.now());
  const sendLock = useRef(false);
  const configLock = useRef(false);
  const validPhone = /^1[3-9]\d{9}$/.test(phone);
  const smsReady = config?.mode === 'development' || config?.mode === 'production';
  const current = codes[phone];
  const seconds = Math.max(0, Math.ceil(((current?.until || 0) - now) / 1000));
  const loadConfig = async () => {
    if (configLock.current) return;
    configLock.current = true; setConfigLoading(true); setConfigError('');
    try { setConfig(await request<Config>('/api/auth/config')); }
    catch (e) { setConfigError((e as Error).message); }
    finally { configLock.current = false; setConfigLoading(false); }
  };
  useEffect(() => {
    let active = true;
    void request<Config>('/api/auth/config').then(result => { if (active) setConfig(result); }).catch(e => { if (active) setConfigError((e as Error).message); }).finally(() => { if (active) setConfigLoading(false); });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const send = async () => {
    if (sendLock.current || busy || seconds || !validPhone || !smsReady) return;
    const target = phone;
    sendLock.current = true; setSending(true); setError('');
    try {
      const result = await request<CodeResult>('/api/auth/send-code', json({ phone: target }));
      const time = Date.now();
      setCodes(previous => ({ ...previous, [target]: { until: time + result.resend_seconds * 1000, expires: time + result.expires_in * 1000, developmentCode: result.development_code } }));
      setError('');
      setNow(time);
    } catch (e) {
      if (e instanceof ApiError && e.retryAfter) {
        const until = Date.now() + e.retryAfter * 1000;
        setCodes(previous => ({ ...previous, [target]: { ...previous[target], expires: previous[target]?.expires || 0, until } }));
      }
      setError(`${target}：${(e as Error).message}`);
    } finally { sendLock.current = false; setSending(false); }
  };
  const verify = async () => {
    if (!validPhone || !/^\d{6}$/.test(code) || sending || busy) return;
    setError('');
    try { await login(phone, code); } catch (e) { setError((e as Error).message); }
  };
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.screen, { flexGrow: 1, justifyContent: 'center', paddingVertical: 36 }]}>
    <Text style={[s.kicker, { letterSpacing: 3 }]}>SHANYI / 善衣</Text>
    <Text style={[s.title, { fontSize: 31, lineHeight: 42, marginTop: 14 }]}>穿得像自己，{`\n`}从今天开始。</Text>
    <Text style={[s.body, { marginTop: 12, color: C.sub }]}>登录后，继续打理你的私人衣橱。</Text>
    <Field label="手机号" value={phone} onChangeText={value => { setPhone(value.replace(/\D/g, '').slice(0, 11)); setCode(''); setError(''); }} numeric />
    {!!phone && !validPhone && <Text style={s.small}>请输入正确的 11 位大陆手机号</Text>}
    <Field label="6 位验证码" value={code} onChangeText={value => { setCode(value.replace(/\D/g, '').slice(0, 6)); setError(''); }} numeric />
    <Button title={sending ? '正在发送…' : seconds ? `${seconds} 秒后可重新获取` : '获取验证码'} soft onPress={() => void send()} disabled={!validPhone || busy || sending || !!seconds || !smsReady} />
    {configLoading && <Text style={[s.small, { marginTop: 12 }]}>正在确认登录服务…</Text>}
    {configError ? <View style={[s.info, { marginTop: 14 }]}><Text style={s.body}>{configError}</Text><Button title="重新检查登录服务" soft onPress={() => void loadConfig()} disabled={configLoading} /></View> : config?.mode === 'production' ? <View style={[s.info, { marginTop: 14 }]}>
      <Text style={s.bold}>短信验证登录</Text><Text style={s.body}>验证码将发送到你的手机，5 分钟内有效。未收到时可稍后重新获取。</Text>
      {!!current && current.expires > now && <Text style={[s.body, { color: C.primary, marginTop: 6 }]}>验证码已发送，请查看短信。</Text>}
      {!!current && current.expires <= now && <Text style={s.body}>验证码已过期，请重新获取。</Text>}
    </View> : config?.mode === 'development' ? <View style={[s.info, { marginTop: 14 }]}>
      <Text style={s.bold}>开发体验模式</Text><Text style={s.body}>当前不发送短信，请先获取开发验证码。</Text>
      {current?.developmentCode && current.expires > now && <Text selectable style={[s.body, { color: C.primary, marginTop: 6 }]}>此手机号的开发验证码：{current.developmentCode}</Text>}
      {current?.developmentCode && current.expires <= now && <Text style={s.body}>验证码已过期，请重新获取。</Text>}
    </View> : config && <Text style={[s.body, { marginTop: 14 }]}>短信登录服务尚未开放，请稍后再来。</Text>}
    {!!error && <Text accessibilityRole="alert" style={[s.body, { color: C.primary, marginTop: 12 }]}>{error}</Text>}
    <Button title={busy ? '正在登录…' : '登录善衣'} onPress={() => void verify()} disabled={!validPhone || !/^\d{6}$/.test(code) || busy || sending || !smsReady} />
    <Text style={[s.small, { marginTop: 18 }]}>首次登录会自动创建账户。手机号只用于登录和账户识别。</Text>
  </ScrollView>;
}
