import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { Image, Modal, Platform, Pressable, Text, View } from 'react-native';
import { Button, Checkbox, C, Icon, Screen, s } from '../components/ui';
import { ApiError, asset, request, useStore } from '../lib/store';

type Result = { image_url: string; notice: string; remote?: boolean };

function FullImage({ uri }: { uri: string }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <View style={{ flex: 1, width: '100%' }}>
    <Image key={attempt} accessibilityLabel="全屏预览图片" source={{ uri }} style={{ flex: 1, width: '100%' }} resizeMode="contain" onError={() => setFailed(true)} onLoad={() => setFailed(false)} />
    {failed && <View style={{ padding: 12, backgroundColor: C.bg }}><Text accessibilityRole="alert" style={s.small}>图片加载失败；链接可能已过期。重新加载不会重新生成或计费。</Text><Button title="仅重新加载图片" soft onPress={() => { setFailed(false); setAttempt(value => value + 1); }} /></View>}
  </View>;
}

function ResultImage({ result }: { result: Result }) {
  const [failed, setFailed] = useState(false);
  const [full, setFull] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  return <View style={{ marginTop: 24 }}>
    <Text style={s.title}>AI 生成结果</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="放大查看 AI 试穿生成结果" onPress={() => setFull(true)}><Image key={loadAttempt} accessibilityLabel="AI 试穿生成结果" source={{ uri: result.image_url }} style={{ width: '100%', aspectRatio: 3 / 4, maxHeight: 520 }} resizeMode="contain" onError={() => setFailed(true)} onLoad={() => setFailed(false)} /></Pressable>
    <Text style={[s.small, { marginVertical: 8 }]}>AI 试穿效果 · 点击放大查看</Text>
    <Modal visible={full} transparent onRequestClose={() => setFull(false)}><View style={{ flex: 1, backgroundColor: '#171411', padding: 20 }}><Button title="关闭大图" soft onPress={() => setFull(false)} /><FullImage key={result.image_url} uri={result.image_url} /></View></Modal>
    {result.remote && <Text style={s.small}>图片由外部服务直接加载，链接有效期由服务商决定，可能过期；本应用未保存远端图片。</Text>}
    {failed && <>
      <Text accessibilityRole="alert" style={s.body}>{result.remote ? '图片加载失败，可能是网络异常、链接已过期或服务商限制访问。重新加载不会重新生成；若链接已过期，重新加载无法续期。' : '生成图片显示失败，请尝试重新加载。'}</Text>
      <Button title="仅重新加载图片（不重新生成）" soft onPress={() => { setFailed(false); setLoadAttempt(value => value + 1); }} />
    </>}
    <Text style={s.small}>{result.notice}</Text>
  </View>;
}
export default function Tryon() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useStore();
  return <TryonContent key={`${user?.phone}:${id}`} id={id} />;
}

function TryonContent({ id }: { id: string }) {
  const { catalog } = useStore();
  const outfit = catalog?.outfits.find(item => item.id === id);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [consent, setConsent] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(true);
  const requestVersion = useRef(0);
  useEffect(() => {
    active.current = true;
    const version = ++requestVersion.current;
    const abort = new AbortController();
    void request<{ available: boolean }>('/api/tryon/config', { signal: abort.signal })
      .then(config => { if (!abort.signal.aborted && version === requestVersion.current) setAvailable(config.available); })
      .catch(e => { if (!abort.signal.aborted && version === requestVersion.current) setError((e as Error).message); });
    return () => { active.current = false; abort.abort(); controller.current?.abort(); };
  }, [attempt]);

  const pick = async () => {
    if (pending.current) return;
    pending.current = true;
    const version = requestVersion.current;
    setError('');
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
      if (active.current && version === requestVersion.current && !picked.canceled) { setPhoto(picked.assets[0]); setConsent(false); setResult(null); }
    } catch (e) { if (active.current && version === requestVersion.current) setError((e as Error).message); }
    finally { if (version === requestVersion.current) pending.current = false; }
  };
  const generate = async () => {
    if (!photo || !outfit || !consent || pending.current) return;
    pending.current = true; setWorking(true); setError(''); setResult(null);
    const version = requestVersion.current;
    controller.current = new AbortController();
    try {
      if (photo.fileSize && photo.fileSize > 5 * 1024 * 1024) throw new Error('照片不能超过 5MB');
      const form = new FormData();
      if (Platform.OS === 'web') {
        const response = await fetch(photo.uri, { signal: controller.current?.signal });
        if (!response.ok) throw new Error('无法读取照片');
        const blob = await response.blob();
        if (blob.size > 5 * 1024 * 1024) throw new Error('照片不能超过 5MB');
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw new Error('请选择 JPG、PNG 或 WEBP');
        form.append('file', blob, photo.fileName || 'person.jpg');
      } else {
        const mime = photo.mimeType || 'image/jpeg';
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('请选择 JPG、PNG 或 WEBP');
        form.append('file', { uri: photo.uri, name: `person.${mime.split('/')[1]}`, type: mime } as unknown as Blob);
      }
      form.append('outfit_id', outfit.id); form.append('consent', 'true');
      const generated = await request<Result>('/api/tryon/generate', { method: 'POST', body: form, signal: controller.current?.signal }, 240000);
      if (active.current && version === requestVersion.current) setResult(generated);
    } catch (e) {
      if (active.current && version === requestVersion.current) {
        const message = (e as Error).message;
        const uncertain = e instanceof ApiError && (e.kind === 'timeout' || e.status === 502 || e.status === 504);
        setError(uncertain && !message.includes('费用') ? `${message}；重试可能再次产生服务商费用。` : message);
      }
    }
    finally { if (version === requestVersion.current) { pending.current = false; if (active.current) setWorking(false); } }
  };

  return <Screen>
    <View style={[s.between, { height: 52 }]}><Pressable accessibilityRole="button" accessibilityLabel="返回" style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }} onPress={() => router.canGoBack() ? router.back() : router.replace('/')}><Icon name="back" /></Pressable><Text style={s.title}>AI 试穿预览</Text></View>
    <Text style={s.small}>AI 穿搭预览不是尺码预测，人物和衣物细节可能有偏差。生成可能需要 1–3 分钟，并产生服务商费用。</Text>
    {outfit ? <View style={[s.card, s.pad, { marginTop: 16 }]}><Text style={s.bold}>{outfit.title}</Text><View style={[s.row, { alignItems: 'flex-start', marginTop: 12 }]}><View style={{ flex: 1 }}><Pressable accessibilityRole="button" accessibilityLabel="放大套装参考图" onPress={() => setPreviewUri(asset(outfit.cover) || null)}><Image accessibilityLabel="套装参考图" source={{ uri: asset(outfit.cover) }} resizeMode="contain" style={{ width: '100%', height: 180, backgroundColor: C.bg, borderRadius: 10 }} /></Pressable><Text style={[s.small, { marginTop: 8 }]}>套装参考 · 点击放大</Text></View><View style={{ flex: 1 }}>{photo ? <Pressable accessibilityRole="button" accessibilityLabel="放大人物照片" onPress={() => setPreviewUri(photo.uri)}><Image accessibilityLabel="待上传人物照片" source={{ uri: photo.uri }} resizeMode="contain" style={{ width: '100%', height: 180, backgroundColor: C.bg, borderRadius: 10 }} /></Pressable> : <View style={{ height: 180, backgroundColor: C.bg, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 8 }}><Icon name="user" /><Text style={s.small}>等待选择照片</Text></View>}<Text style={[s.small, { marginTop: 8 }]}>我的照片{photo ? ' · 点击放大' : ''}</Text></View></View><Text style={[s.small, { marginTop: 12 }]}>生成结果将在下方单独显示。</Text></View> : <Text style={s.empty}>套装不存在，请返回目录重新选择。</Text>}
    {available === null ? <Button title="重新检查服务配置" soft disabled={working} onPress={() => { if (!pending.current) { setError(''); setAttempt(value => value + 1); } }} /> : !available ? <Text accessibilityRole="alert" style={s.empty}>AI 试穿服务未配置，请管理员填写后端 SHANYI_TRYON 配置后重试。</Text> : null}
    <Button title="选择人物照片" disabled={!available || !outfit || working} onPress={() => void pick()} />
    <Modal visible={!!previewUri} transparent onRequestClose={() => setPreviewUri(null)}><View style={{ flex: 1, backgroundColor: '#171411', padding: 20 }}><Button title="关闭大图" soft onPress={() => setPreviewUri(null)} />{previewUri && <FullImage key={previewUri} uri={previewUri} />}</View></Modal>
    <Text style={[s.small, { marginTop: 12 }]}>支持完整 JPG、PNG、WEBP，最大 5MB。照片仅在本次请求中处理，不存入衣橱；外部服务商的数据保留规则由其政策决定。</Text>
    <Checkbox label="同意将本人人物照和套装参考图发送到已配置的外部 AI 服务" description="仅用于本次生成。更换人物照片后需重新确认。" checked={consent} disabled={working} onChange={setConsent} />
    <Button title={working ? '正在生成，请稍候…' : '生成 AI 试穿预览'} disabled={!available || !outfit || !photo || !consent || working} onPress={() => void generate()} />
    {working && <Text accessibilityRole="alert" style={s.small}>请勿重复提交。离开页面会取消等待，但外部生成可能仍继续计费。</Text>}
    {!!error && <Text accessibilityRole="alert" style={[s.body, { marginTop: 16 }]}>{error}</Text>}
    {result && <ResultImage result={result} />}
  </Screen>;
}
