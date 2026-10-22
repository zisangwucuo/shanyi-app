import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Button, Screen, Section, Sheet, s } from '../components/ui';
import { ApiError, json, request, useStore } from '../lib/store';

type Preview = { exported_at: string; wardrobe_count: number; record_count: number; feedback_count: number; image_count: number; can_restore: boolean; outfit_set_count: number; shared_set_count: number; reason?: string };
const maxBytes = 50 * 1024 * 1024;
const postBackup = (body: string) => ({ ...json(null), body });
export default function DataScreen() {
  const { user, refresh, busy } = useStore();
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<{ name: string; body: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [restored, setRestored] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);
  const disabled = !!working || busy;
  const run = async (label: string, action: () => Promise<void>) => {
    if (lock.current || busy) return;
    lock.current = true; setWorking(label); setError(''); setNotice('');
    try { await action(); } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setWorking(''); }
  };
  const exportBackup = () => run('正在准备备份…', async () => {
    if (Platform.OS !== 'web' && !await Sharing.isAvailableAsync()) throw new Error('当前设备无法打开文件分享，请使用网页版下载备份。');
    const data = await request<unknown>('/api/user/backup');
    const body = JSON.stringify(data);
    const name = `shanyi-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    if (Platform.OS === 'web') {
      const blob = new Blob([body], { type: 'application/json' });
      if (blob.size > maxBytes) throw new Error('备份超过 50MB，无法导出。');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNotice('已发起下载，请在浏览器下载列表中确认并妥善保存。');
    } else {
      if (new TextEncoder().encode(body).byteLength > maxBytes) throw new Error('备份超过 50MB，无法导出。');
      const file = new File(Paths.cache, name);
      file.create(); file.write(body);
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: '保存善衣备份' });
      setNotice('已打开系统分享。请确认已将 JSON 文件保存到安全位置。');
    }
  });
  const inspect = async (body: string) => {
    const result = await request<Preview>('/api/user/restore/preview', postBackup(body));
    setPreview(result); setUncertain(false);
  };
  const pickBackup = () => run('正在读取备份…', async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: true, base64: false });
    if (result.canceled) return;
    const picked = result.assets[0];
    if ((picked.size || picked.file?.size || 0) > maxBytes) throw new Error('请选择不超过 50MB 的 JSON 备份。');
    let body: string;
    if (Platform.OS === 'web') {
      if (!picked.file) throw new Error('浏览器未提供可读取文件，请重新选择。');
      body = await picked.file.text();
    } else {
      const file = new File(picked.uri);
      if (file.size > maxBytes) throw new Error('请选择不超过 50MB 的 JSON 备份。');
      body = await file.text();
    }
    if (new TextEncoder().encode(body).byteLength > maxBytes) throw new Error('请选择不超过 50MB 的 JSON 备份。');
    try { const parsed = JSON.parse(body); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); }
    catch { throw new Error('文件不是有效的 JSON 备份，请选择从善衣导出的文件。'); }
    setSelected({ name: picked.name, body }); setPreview(null); setRestored(false); setUncertain(false);
    await inspect(body);
  });
  const restore = () => run('正在恢复，请保持页面开启…', async () => {
    if (!selected || !preview?.can_restore || restored || uncertain) return;
    setConfirm(false);
    try { await request('/api/user/restore', postBackup(selected.body)); }
    catch (e) {
      setUncertain(true);
      if (e instanceof ApiError && e.status === 409) setPreview({ ...preview, can_restore: false, reason: e.message });
      throw new Error(`恢复未能确认：${(e as Error).message}。请先刷新账户并重新检查备份，再决定是否恢复。`);
    }
    setRestored(true); setPreview(null); setSelected(null);
    setNotice('备份已恢复到当前账号。');
    try { await refresh(); }
    catch { setNotice('备份已恢复，但页面内容暂未更新。请重新刷新，不要重复导入。'); }
  });
  return <Screen>
    <Button title="← 返回我的" soft disabled={!!working} onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/profile'); }} />
    <Text style={[s.kicker, { marginTop: 24 }]}>YOUR DATA</Text>
    <Text style={[s.title, { fontSize: 27, marginTop: 10 }]}>衣橱备份</Text>
    <Text style={[s.body, { marginTop: 10 }]}>给好好积累的衣物与穿搭，留一份副本。</Text>
    <Section title="保存一份副本" en="EXPORT" />
    <View style={[s.card, s.pad]}><Text style={s.body}>导出当前账号的资料、衣橱、保存的套装、已分享快照、穿搭历史和偏好。</Text><Button title="导出 JSON 备份" onPress={() => void exportBackup()} disabled={disabled} /><Text style={[s.small, { marginTop: 12 }]}>含已上传图片的完整数据；外部图片仅保存地址。不含会员、订单与登录凭证。文件包含个人资料，请妥善保管。</Text></View>
    <Section title="从副本恢复" en="IMPORT" />
    <View style={[s.card, s.pad]}><Text style={s.bold}>恢复到当前账号：{user?.phone}</Text><Text style={[s.body, { marginTop: 8 }]}>仅可恢复到业务空账户，不会合并或覆盖已有衣橱。资料会替换为备份中的资料，认证手机号保持当前账号。</Text><Button title={selected ? '重新选择 JSON 文件' : '选择 JSON 备份'} soft onPress={() => void pickBackup()} disabled={disabled} /><Text style={[s.small, { marginTop: 10 }]}>最多 50MB。选择后先检查内容，不会立即写入。</Text></View>
    {!!working && <Text accessibilityLiveRegion="polite" style={s.body}>{working}</Text>}
    {!!error && <View style={s.info}><Text accessibilityRole="alert" style={s.body}>{error}</Text></View>}
    {!!notice && <View style={s.info}><Text accessibilityLiveRegion="polite" style={s.body}>{notice}</Text></View>}
    {selected && <View style={[s.card, s.pad]}><Text style={s.bold}>{selected.name}</Text>
      {preview && <><Text style={[s.body, { marginTop: 10 }]}>备份日期：{new Date(preview.exported_at).toLocaleString('zh-CN')}</Text><View style={[s.row, { flexWrap: 'wrap', marginVertical: 14 }]}>{[[preview.wardrobe_count, '件衣物'], [preview.record_count, '条历史'], [preview.feedback_count, '条反馈'], [preview.image_count, '张本地图片'], [preview.outfit_set_count, '套保存搭配'], [preview.shared_set_count, '份分享快照']].map(([count, label]) => <Text key={label} style={s.tag}>{count} {label}</Text>)}</View><Text style={s.body}>{preview.can_restore ? '备份检查通过，当前账号可恢复。' : preview.reason || '当前账号不满足恢复条件。'}</Text></>}
      {uncertain && <Text style={[s.body, { marginTop: 10 }]}>上次提交结果待确认，暂不能再次写入。请先检查账户内容。</Text>}
      <Button title="重新检查备份与账户" soft disabled={disabled} onPress={() => void run('正在重新检查…', async () => { await refresh(); await inspect(selected.body); })} />
      {preview?.can_restore && !uncertain && <Button title="恢复到当前账号" disabled={disabled} onPress={() => setConfirm(true)} />}
      <Button title="取消本次导入" soft disabled={disabled} onPress={() => { setSelected(null); setPreview(null); setError(''); setUncertain(false); }} />
    </View>}
    <Sheet title="确认恢复到当前账号" visible={confirm} onClose={() => { if (!working) setConfirm(false); }}><Text style={[s.body, { marginTop: 14 }]}>将这份备份的资料、衣物和穿搭记录写入 {user?.phone}。仅允许空账户恢复，手机号及现有会员权益不变。已分享快照仅恢复为私人套装（相同内容不重复），不会自动发布；请在我的套装中再次确认分享。</Text><Button title="确认写入并恢复" disabled={disabled} onPress={() => void restore()} /><Button title="先不恢复" soft disabled={disabled} onPress={() => setConfirm(false)} /></Sheet>
  </Screen>;
}
