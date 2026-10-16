import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, C, Field, s } from '../components/ui';
import { request, json, useStore } from '../lib/store';
export default function Login() {
  const { login, busy, notify } = useStore();
  const [phone, setPhone] = useState(''); const [code, setCode] = useState(''); const [sent, setSent] = useState(false); const [sending, setSending] = useState(false);
  const send = async () => { if (sending) return; setSending(true); try { await request('/api/auth/send-code', json({ phone })); setSent(true); notify('验证码已发送，开发环境验证码为 123456'); } catch (e) { notify((e as Error).message); } finally { setSending(false); } };
  const verify = async () => { try { await login(phone, code); } catch (e) { notify((e as Error).message); } };
  return <View style={[s.screen, { flex: 1, justifyContent: 'center' }]}><Text style={[s.kicker, { letterSpacing: 3 }]}>SHANYI / 善衣</Text><Text style={[s.title, { fontSize: 31, marginTop: 14 }]}>穿得像自己，{`\n`}从今天开始。</Text><Text style={[s.body, { marginTop: 12, color: C.sub }]}>用手机验证码进入你的私人衣橱。</Text><Field label="手机号" value={phone} onChangeText={setPhone} numeric /><View style={s.row}><View style={{ flex: 1 }}><Field label="验证码" value={code} onChangeText={setCode} numeric /></View><Button title={sending ? '发送中…' : sent ? '重新发送' : '获取验证码'} soft onPress={() => void send()} disabled={!phone || busy || sending} /></View><Button title={busy ? '正在登录…' : '登录善衣'} onPress={() => void verify()} disabled={!phone || !code || busy || sending} /><Text style={[s.small, { marginTop: 18 }]}>首次登录会自动创建你的善衣账户。验证码为开发演示流程，非生产级身份认证。</Text></View>;
}
