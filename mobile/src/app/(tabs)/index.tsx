import { useEffect, useRef, useState } from 'react';
import { Image, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { Link, router } from 'expo-router';
import { Button, Checkbox, Chips, C, Icon, OutfitSummary, Photo, Screen, Sheet, s } from '../../components/ui';
import { filterByAudience, effectiveOutfitPreference, json, request, useStore, type WearRecord } from '../../lib/store';
import { clothingCategories, filterMissingCategories } from '../../lib/stylist-state';

type VisibleItem = { category: string; name: string; color: string };
type Suggestion = { category: string; name: string; reason: string; wardrobe_item: { name: string } | null; catalog_item: { name: string } | null };
type StylistPlan = { plan_id: string; token: string; title: string; reason: string; items: { id: string; name: string; image: string | null; category: string; status: 'visible' | 'wardrobe' | 'missing'; wardrobe_name?: string }[] };
type PreviewResult = { image_url: string; notice: string; remote?: boolean };
type FlowStep = 'context' | 'photo' | 'review' | 'results';
type CurrentWeather = { status: 'ok'; city: string; weather: string; weather_code: number; temperature: number; stylist_weather: string; location: string; observed_at: string; timezone: string } | { status: 'missing_city' | 'not_found' | 'ambiguous' | 'timeout' | 'unavailable'; city: string; message: string };

function PreviewImage({ uri, full = false, aspectRatio = 3 / 4, onPress }: { uri?: string; full?: boolean; aspectRatio?: number; onPress?: () => void }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (!uri) return null;
  const retry = () => { setFailed(false); setAttempt(value => value + 1); };
  const image = <Image key={attempt} accessibilityLabel="穿搭预览图片" source={{ uri }} style={full ? { flex: 1, width: '100%' } : { width: '100%', aspectRatio, maxHeight: 320 }} resizeMode="contain" onLoad={() => setFailed(false)} onError={() => setFailed(true)} />;
  return <View style={full ? { flex: 1, width: '100%' } : { width: '100%' }}>
    {onPress && !failed ? <Pressable accessibilityRole="button" accessibilityLabel="全屏查看预览" style={full ? { flex: 1 } : undefined} onPress={onPress}>{image}</Pressable> : image}
    {failed && <View style={{ padding: 12, gap: 8, backgroundColor: C.bg }}><Text accessibilityRole="alert" style={s.small}>图片加载失败，可重新加载；链接过期需重新生成。重新加载不产生生成费用。</Text><Button title="仅重新加载图片" soft onPress={retry} /></View>}
  </View>;
}

const weatherOptions = ['晴朗', '多云', '雨天', '雪天'];
const defaultOccasions = ['通勤', '约会', '周末', '雨天', '运动', '旅行', '聚会', '居家', '正式场合'];

export default function Home() {
  const { user } = useStore();
  return <HomeContent key={user?.phone || 'guest'} />;
}

function HomeContent() {
  const { user, catalog, wardrobe, activity, recommendations } = useStore();
  const city = user?.city?.trim() || '';
  const [weatherResult, setWeatherResult] = useState<CurrentWeather | null>(null);
  const [weatherAttempt, setWeatherAttempt] = useState(0);
  if (weatherResult && weatherResult.city !== city) setWeatherResult(null);
  const liveWeather = weatherResult?.city === city ? weatherResult : null;
  const weatherLoading = !!user && !liveWeather;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    if (!user?.phone) return;
    void request<CurrentWeather>('/api/weather', { signal: controller.signal })
      .then(result => {
        if (active) setWeatherResult(result.city === city ? result : { status: 'unavailable', city, message: '资料城市已变化，请刷新资料后重试。' });
      })
      .catch(error => { if (active) setWeatherResult({ status: 'unavailable', city, message: (error as Error).message }); });
    return () => { active = false; controller.abort(); };
  }, [city, user?.phone, weatherAttempt]);
  const pending = useRef(false);
  const generation = useRef(0);
  const [stylistOpen, setStylistOpen] = useState(false);
  const [step, setStep] = useState<FlowStep>('context');
  const [weather, setWeather] = useState('');
  const [temperature, setTemperature] = useState('');
  const [occasion, setOccasion] = useState('通勤');
  const [visionAvailable, setVisionAvailable] = useState<boolean | null>(null);
  const [stylistAvailable, setStylistAvailable] = useState(false);
  const [checkingVision, setCheckingVision] = useState(false);
  const [configError, setConfigError] = useState('');
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [recognized, setRecognized] = useState<VisibleItem[]>([]);
  const [missingCategories, setMissingCategories] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [plans, setPlans] = useState<StylistPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState(0);
  const [previews, setPreviews] = useState<Record<string, PreviewResult>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewConsent, setPreviewConsent] = useState(false);
  const [visionConsent, setVisionConsent] = useState(false);
  const [showEdited, setShowEdited] = useState(false);
  const [fullPreview, setFullPreview] = useState(false);
  const [note, setNote] = useState('');
  const [shoppingError, setShoppingError] = useState('');
  const [flowError, setFlowError] = useState('');
  const [working, setWorking] = useState(false);
  const todayRecord = activity.records.find((record: WearRecord) => record.date === activity.today);
  const occasions = (catalog?.occasions || defaultOccasions).filter(value => value !== '全部');
  const preference = effectiveOutfitPreference(user);
  const outfitDirection = preference === 'male' ? '男装与中性穿搭' : preference === 'female' ? '女装与中性穿搭' : preference === 'unisex' ? '中性穿搭' : '全部受众';

  const featuredPlan = recommendations[0];
  const featured = featuredPlan?.outfit || filterByAudience(catalog?.outfits || [], user)[0];
  const unworn = wardrobe.filter(item => item.wear_count === 0);
  const wardrobePreview = (unworn.length ? unworn : wardrobe).slice(0, 3);

  useEffect(() => {
    const session = generation;
    return () => { ++session.current; };
  }, []);

  const validTemperature = (value: string) => /^-?\d+(\.\d+)?$/.test(value.trim()) && Number(value) >= -30 && Number(value) <= 50;
  const closeStylist = () => {
    if (pending.current) return;
    ++generation.current;
    setStylistOpen(false);
  };
  const checkVision = () => {
    const version = generation.current;
    setCheckingVision(true);
    setConfigError('');
    void request<{ vision_available: boolean; stylist_available: boolean }>('/api/stylist/config')
      .then(result => { if (version === generation.current) { setVisionAvailable(result.vision_available); setStylistAvailable(result.stylist_available); } })
      .catch(error => { if (version === generation.current) { setVisionAvailable(null); setConfigError((error as Error).message); } })
      .finally(() => { if (version === generation.current) setCheckingVision(false); });
  };

  const openStylist = () => {
    if (pending.current) return;
    ++generation.current;
    setWeather(liveWeather?.status === 'ok' ? liveWeather.stylist_weather : '');
    setTemperature(liveWeather?.status === 'ok' ? String(liveWeather.temperature) : '');
    setStep('context');
    setPhoto(null);
    setRecognized([]);
    setMissingCategories([]);
    setSuggestions([]);
    setPlans([]);
    setPreviews({});
    setPreviewErrors({});
    setSelectedPlan(0);
    setPreviewConsent(false);
    setVisionConsent(false);
    setShowEdited(false);
    setNote('');
    setShoppingError('');
    setFlowError('');
    setStylistOpen(true);
    setVisionAvailable(null);
    checkVision();
  };

  const pickPhoto = async (camera: boolean) => {
    if (pending.current) return;
    const version = generation.current;
    pending.current = true;
    setWorking(true);
    try {
      if (camera && Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (version !== generation.current) return;
        if (!permission.granted) {
          setFlowError(permission.canAskAgain ? '需要相机权限才能拍照，也可以改从相册选择。' : '相机权限已关闭，请在系统设置中允许访问，或改从相册选择。');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [3, 4], quality: 0.8 };
      const result = await (camera ? ImagePicker.launchCameraAsync(options) : ImagePicker.launchImageLibraryAsync(options));
      if (version !== generation.current) return;
      if (!result.canceled && result.assets[0]) {
        setPhoto(result.assets[0]);
        setVisionConsent(false);
        setPreviewConsent(false);
        setRecognized([]);
        setMissingCategories([]);
        setPlans([]);
        setPreviews({});
        setPreviewErrors({});
        setShowEdited(false);
        setFlowError('');
      }
    } catch (error) {
      if (version === generation.current) setFlowError(`无法打开照片：${(error as Error).message}`);
    } finally {
      if (version === generation.current) { pending.current = false; setWorking(false); }
    }
  };

  const analyzePhoto = async () => {
    if (!photo || pending.current || !visionConsent) return;
    if (photo.fileSize && photo.fileSize > 5 * 1024 * 1024) {
      setFlowError('照片不能超过 5MB，请选择较小的 JPG、PNG 或 WEBP 图片。');
      return;
    }
    const version = generation.current;
    pending.current = true;
    setWorking(true);
    setFlowError('');
    try {
      const form = new FormData();
      if (Platform.OS === 'web') {
        const response = await fetch(photo.uri);
        if (!response.ok) throw new Error('无法读取所选照片');
        const blob = await response.blob();
        const mime = photo.mimeType || blob.type;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('仅支持 JPG、PNG 或 WEBP 图片');
        form.append('file', blob, photo.fileName || 'selfie.jpg');
      } else {
        const mime = photo.mimeType || 'image/jpeg';
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('仅支持 JPG、PNG 或 WEBP 图片');
        form.append('file', { uri: photo.uri, name: `selfie.${mime.split('/')[1]}`, type: mime } as unknown as Blob);
      }
      form.append('consent', 'true');
      const result = await request<{ items: VisibleItem[] }>('/api/stylist/analyze', { method: 'POST', body: form });
      if (version !== generation.current) return;
      setRecognized(result.items);
      setStep('review');
    } catch (error) {
      if (version === generation.current) setFlowError((error as Error).message);
    } finally {
      if (version === generation.current) { pending.current = false; setWorking(false); }
    }
  };

  const completeOutfit = async () => {
    if (pending.current || !weather || !recognized.length) return;
    const safeMissingCategories = filterMissingCategories(missingCategories, recognized);
    if (safeMissingCategories.length !== missingCategories.length) setMissingCategories(safeMissingCategories);
    if (!safeMissingCategories.length) {
      setFlowError('请至少确认一个需要补齐的缺失类别。');
      return;
    }
    const degrees = Number(temperature);
    if (!validTemperature(temperature)) {
      setFlowError('温度请输入 -30 到 50℃ 之间的数字。');
      return;
    }
    const version = generation.current;
    pending.current = true;
    setWorking(true);
    setFlowError('');
    try {
      const result = await request<{ suggestions: Suggestion[]; note: string; source?: string; plans?: StylistPlan[] }>('/api/stylist/complete', json({
        weather,
        temperature: degrees,
        occasion,
        items: recognized,
        missing_categories: safeMissingCategories,
      }), 150000);
      if (version !== generation.current) return;
      setSuggestions(result.suggestions);
      setPlans(result.plans || []);
      setSelectedPlan(0);
      setPreviews({});
      setPreviewErrors({});
      setPreviewConsent(false);
      setShowEdited(false);
      setNote(result.note);
      setStep('results');
    } catch (error) {
      if (version === generation.current) setFlowError((error as Error).message);
    } finally {
      if (version === generation.current) { pending.current = false; setWorking(false); }
    }
  };

  const generatePreview = async () => {
    const plan = plans[selectedPlan];
    if (!plan || !photo || !previewConsent || pending.current || previews[plan.plan_id]) return;
    pending.current = true; setPreviewBusy(true); setFlowError('');
    const version = generation.current;
    setPreviewErrors(current => { const next = { ...current }; delete next[plan.plan_id]; return next; });
    try {
      const form = new FormData();
      if (Platform.OS === 'web') {
        const response = await fetch(photo.uri);
        if (!response.ok) throw new Error('无法读取原自拍');
        const blob = await response.blob();
        if (blob.size > 5 * 1024 * 1024) throw new Error('照片不能超过 5MB');
        form.append('file', blob, photo.fileName || 'selfie.jpg');
      } else {
        const mime = photo.mimeType || 'image/jpeg';
        form.append('file', { uri: photo.uri, name: `selfie.${mime.split('/')[1]}`, type: mime } as unknown as Blob);
      }
      form.append('token', plan.token);
      form.append('consent', 'true');
      if (version !== generation.current) return;
      const result = await request<PreviewResult>('/api/stylist/preview', { method: 'POST', body: form }, 240000);
      if (version !== generation.current) return;
      setPreviews(current => ({ ...current, [plan.plan_id]: result }));
      setShowEdited(true);
    } catch (error) {
      if (version === generation.current) setPreviewErrors(current => ({ ...current, [plan.plan_id]: (error as Error).message }));
    }
    finally { if (version === generation.current) { pending.current = false; setPreviewBusy(false); } }
  };

  const returnToReviewForReconfirmation = () => {
    if (pending.current || !photo) return;
    ++generation.current;
    setPlans([]);
    setSuggestions([]);
    setPreviews({});
    setPreviewErrors({});
    setPreviewConsent(false);
    setVisionConsent(false);
    setShowEdited(false);
    setFullPreview(false);
    setNote('');
    setShoppingError('');
    setFlowError('');
    setStep('review');
  };

  const searchTaobao = async (name: string) => {
    setShoppingError('');
    try {
      await Linking.openURL(`https://s.taobao.com/search?q=${encodeURIComponent(name)}`);
    } catch {
      setShoppingError(`无法打开淘宝搜索，请重试，或在淘宝搜索「${name}」。`);
    }
  };

  const addCategory = (category: string) => {
    if (!pending.current && !recognized.some(item => item.category === category)) {
      setRecognized(items => [...items, { category, name: category, color: '' }]);
      setMissingCategories(current => current.filter(value => value !== category));
    }
  };

  return <Screen>
    <View style={home.greeting}>
      <View style={s.between}>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>日常穿搭 · {user?.city || '我的衣橱'}</Text>
          <Text style={[s.small, { marginTop: 4 }]}>穿搭方向 · {outfitDirection}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="打开个人资料，修改性别与穿搭偏好" style={home.profileAction} onPress={() => router.navigate('/profile')}>
          <Icon name="user" color={C.primary} />
          <Text style={s.link}>个人资料</Text>
        </Pressable>
      </View>
      <Text style={home.greetingTitle}>今天，也穿得自在</Text>
      <Text style={s.small}>{user?.name ? `${user.name}，` : ''}从你的衣橱里，找到今天的灵感。</Text>
    </View>

    <View style={home.weatherCard}>
      <View style={s.between}>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>穿搭天气 · {city || '未设置城市'}</Text>
          <Text style={[s.title, { fontSize: 21, marginTop: 7 }]}>{liveWeather?.status === 'ok' ? `${liveWeather.weather} · ${liveWeather.temperature}℃` : weatherLoading || !liveWeather ? '正在获取天气…' : '暂未获取天气'}</Text>
          <Text style={[s.small, { marginTop: 5 }]}>账户资料城市 · 非 GPS 定位 · Open-Meteo</Text>
          {liveWeather?.status === 'ok' ? <Text style={[s.small, { marginTop: 5 }]}>{liveWeather.location} · {liveWeather.observed_at.replace('T', ' ')}（{liveWeather.timezone}）</Text> : liveWeather && <Text accessibilityRole="alert" style={[s.small, { marginTop: 5 }]}>{liveWeather.message}</Text>}
        </View>
        <View style={home.weatherIcon}><Icon name={liveWeather?.status === 'ok' && liveWeather.weather_code === 0 ? 'sun' : 'cloud'} color={C.primary} /></View>
      </View>
      <Pressable accessibilityRole="button" disabled={weatherLoading} style={home.weatherAction} onPress={() => { setWeatherResult(null); setWeatherAttempt(value => value + 1); }}>
        <Text style={s.link}>{weatherLoading ? '正在获取…' : liveWeather?.status === 'ok' ? '刷新天气' : '重试获取'} →</Text>
      </Pressable>
      {(!city || liveWeather?.status === 'ambiguous' || liveWeather?.status === 'not_found') && <Pressable accessibilityRole="button" style={home.textAction} onPress={() => router.navigate('/profile')}><Text style={s.link}>去个人资料设置城市 →</Text></Pressable>}
    </View>

    <View style={home.sectionHeading}><Text style={s.title}>给今天的一套灵感</Text><Pressable accessibilityRole="button" style={home.textAction} onPress={() => router.navigate('/recommend')}><Text style={s.link}>更多搭配 →</Text></Pressable></View>
    {featured ? <Pressable accessibilityRole="button" accessibilityLabel={`查看精选搭配：${featured.title}`} style={home.featured} onPress={() => router.push({ pathname: '/set-detail', params: { id: featured.id } })}>
      <Photo uri={featured.cover} aspectRatio={4 / 3} />
      <Text style={home.featuredLabel}>{featuredPlan ? '衣橱推荐 · 精选一套' : '目录搭配 · 灵感参考'}</Text>
      <View style={home.featuredCaption}>
        <Text style={s.kicker}>{[featured.occasion, featured.style].filter(Boolean).join(' / ')}</Text>
        <View style={s.between}><Text numberOfLines={2} style={[s.title, { flex: 1, lineHeight: 28 }]}>{featured.title}</Text><Text style={s.link}>看这套 →</Text></View>
        <OutfitSummary plan={featuredPlan} />
      </View>
    </Pressable> : <View style={home.empty}><Text style={s.bold}>搭配灵感还未就绪</Text><Text style={s.small}>下拉刷新，或先到衣橱整理单品。</Text><Button title="去衣橱看看" soft onPress={() => router.navigate('/wardrobe')} /></View>}

    <View style={home.stylistCard}>
      <View style={s.row}><View style={home.stylistMark}><Icon name="sparkles" color="#fff" /></View><View style={{ flex: 1 }}><Text style={s.title}>穿好了，还差一点？</Text><Text style={s.small}>AI 补齐 · 天气场合 → 自拍 → 确认 → 建议</Text></View></View>
      <Button title={step === 'results' ? '继续查看补齐方案' : '拍下穿搭，让 AI 帮我补齐'} onPress={() => step === 'results' ? setStylistOpen(true) : openStylist()} />
    </View>

    <View style={home.sectionHeading}><Text style={s.title}>今日穿着</Text><Text style={s.small}>{todayRecord ? '已记录' : '尚未记录'}</Text></View>
    {todayRecord ? <Pressable accessibilityRole="button" accessibilityLabel={`查看今日穿着：${todayRecord.outfit.title}`} style={home.record} onPress={() => router.push({ pathname: '/set-detail', params: { id: todayRecord.outfit_id } })}>
      <View style={home.recordPhoto}><Photo uri={todayRecord.outfit.cover} square /></View><View style={{ flex: 1 }}><Text numberOfLines={2} style={s.bold}>{todayRecord.outfit.title}</Text><Text style={s.small}>已关联 {todayRecord.items.length} 件衣橱单品</Text></View><Text style={s.link}>详情 →</Text>
    </Pressable> : <View style={home.dailyEmpty}><Text style={s.body}>今天穿了哪一套？</Text><Text style={s.small}>在搭配详情点「今天已穿」，留下今天的记录。</Text><Pressable accessibilityRole="button" style={home.textAction} onPress={() => featured ? router.push({ pathname: '/set-detail', params: { id: featured.id } }) : router.navigate('/recommend')}><Text style={s.link}>去选一套 →</Text></Pressable></View>}

    <View style={home.sectionHeading}><Text style={s.title}>让衣橱常穿常新</Text><Pressable accessibilityRole="button" style={home.textAction} onPress={() => router.navigate('/wardrobe')}><Text style={s.link}>管理衣橱 →</Text></Pressable></View>
    {wardrobe.length ? <>
      <View style={home.closetStats}>{[{ value: wardrobe.length, label: '件衣物' }, { value: unworn.length, label: '件尚无穿着记录' }, { value: wardrobe.reduce((total, item) => total + item.wear_count, 0), label: '次累计穿着' }].map(stat => <View key={stat.label} style={{ flex: 1 }}><Text style={home.statValue}>{stat.value}</Text><Text style={s.small}>{stat.label}</Text></View>)}</View>
      <Text style={[s.small, { marginBottom: 12 }]}>{unworn.length ? '这些单品，还没有留下穿着记录' : '熟悉的衣物，也能搭出新意'}</Text>
      <View style={home.wardrobeRow}>{wardrobePreview.map(item => <View key={item.id} style={{ flex: 1 }}><View style={home.itemPhoto}><Photo uri={item.image_url || undefined} square /></View><Text numberOfLines={1} style={[s.body, { marginTop: 8 }]}>{item.name}</Text><Text style={s.small}>穿过 {item.wear_count} 次</Text></View>)}</View>
    </> : <View style={home.empty}><Icon name="shirt" color={C.primary} /><Text style={[s.bold, { marginTop: 12 }]}>从第一件喜欢的衣物开始</Text><Text style={s.small}>到衣橱添加自己的衣物{catalog?.wardrobeSamples?.length ? '，也可以先预览并导入样例' : ''}。</Text><Button title="去衣橱添加" soft onPress={() => router.navigate('/wardrobe')} /></View>}

    <Sheet title={step === 'context' ? '先选穿搭条件' : step === 'photo' ? '上传今日自拍' : step === 'review' ? '确认识别结果' : '为你补齐整套穿搭'} visible={stylistOpen} onClose={closeStylist}>
      {working && <Text accessibilityRole="alert" style={[s.small, { marginBottom: 12 }]}>正在处理，请稍候。完成前暂不能关闭、返回或修改衣物。</Text>}
      <View style={home.steps}>{[['context', '1 天气与场合'], ['photo', '2 自拍'], ['review', '3 确认'], ['results', '4 补齐']].map(([value, label]) => <Text key={value} style={[s.small, step === value && home.activeStep]}>{label}</Text>)}</View>

      {step === 'context' && <>
        <Text style={[s.body, { marginTop: 10 }]}>打开时若天气已获取，会作为初始参考；你可手动修改天气、温度与场合，后续刷新不会覆盖本次输入。</Text>
        <Text style={s.label}>天气</Text><Chips values={weatherOptions} selected={weather} onSelect={setWeather} />
        <Text style={s.label}>温度（℃）</Text><TextInput accessibilityLabel="温度，摄氏度" placeholder="例如 18" placeholderTextColor={C.sub} keyboardType="numbers-and-punctuation" value={temperature} onChangeText={setTemperature} style={s.input} />
        <Text style={s.label}>场合</Text><Chips values={occasions} selected={occasion} onSelect={setOccasion} />
        <View style={[s.info, { marginTop: 12 }]}>
          {checkingVision ? <Text style={s.body}>正在检查视觉识别服务…</Text> : configError ? <><Text style={s.bold}>暂时无法确认识别服务状态</Text><Text style={s.small}>{configError}</Text><Button title="重新检查" soft onPress={checkVision} /></> : visionAvailable === false ? <><Text style={s.bold}>AI 识别暂未配置</Text><Text style={s.small}>照片不会上传。请管理员配置服务后再使用自拍识别。</Text></> : visionAvailable ? <Text style={s.small}>服务已配置；照片仅用于本次可见衣物识别，不会自动加入衣橱。</Text> : null}
        </View>
        {!checkingVision && !configError && <Text style={s.small}>{stylistAvailable ? 'AI 补齐已配置：确认衣物后，衣物名称、天气场合和当前衣橱候选会发送至外部模型。' : 'AI 补齐未配置：识别后仅提供明确标注的规则参考。'}</Text>}
        <Button title="下一步：上传自拍" disabled={!weather || !temperature.trim() || checkingVision || !visionAvailable} onPress={() => { if (!validTemperature(temperature)) { setFlowError('温度请输入 -30 到 50℃ 之间的数字。'); return; } setFlowError(''); setStep('photo'); }} />
      </>}

      {step === 'photo' && <>
        <Text style={[s.body, { marginTop: 10 }]}>尽量选择能看清当日穿搭的照片。只识别可见衣物，不分析人脸或身体；照片会发送到服务端已配置的视觉服务，不会加入衣橱。</Text>
        {photo ? <View style={home.photoFrame}><Image accessibilityLabel="待识别自拍预览" source={{ uri: photo.uri }} resizeMode="cover" style={home.photo} /></View> : <View style={home.photoEmpty}><Icon name="shirt" color={C.primary} /><Text style={[s.small, { marginTop: 8 }]}>选择自拍照片后在这里预览</Text></View>}
        <Button title={Platform.OS === 'web' ? '拍照 / 浏览器选择' : '拍摄自拍'} soft disabled={working} onPress={() => void pickPhoto(true)} />
        <Button title="从相册选择" soft disabled={working} onPress={() => void pickPhoto(false)} />
        <Text style={[s.small, { marginTop: 8 }]}>支持 JPG、PNG、WEBP，最大 5MB。</Text>
        <Checkbox label="同意将自拍发送给已配置的外部 AI 视觉识别服务" description="仅用于本次衣物识别，不会自动加入衣橱。" checked={visionConsent} onChange={setVisionConsent} disabled={working} />
        <Button title={working ? '正在识别可见衣物…' : '识别照片中的衣物'} disabled={!photo || !visionConsent || working} onPress={() => void analyzePhoto()} />
        <Pressable accessibilityRole="button" disabled={working} accessibilityState={{ disabled: working }} style={{ padding: 12, alignItems: 'center', opacity: working ? 0.5 : 1 }} onPress={() => { if (!pending.current) setStep('context'); }}><Text style={s.link}>返回修改天气与场合</Text></Pressable>
      </>}

      {step === 'review' && <>
        <Text style={[s.body, { marginTop: 10 }]}>请核对照片中看得见的衣物。可以调整类别、移除误识别项，或手动补充漏掉的类别。</Text>
        {photo && <View style={[home.photoFrame, { maxHeight: 220 }]}><Image accessibilityLabel="已识别自拍" source={{ uri: photo.uri }} resizeMode="cover" style={[home.photo, { maxHeight: 220 }]} /></View>}
        {recognized.map((item, index) => <View key={`${item.name}-${index}`} style={home.detectedItem}>
          <View style={s.between}><Text style={s.bold}>{item.name}</Text><Pressable accessibilityRole="button" accessibilityLabel={`移除${item.name}`} disabled={working} onPress={() => { if (!pending.current) setRecognized(items => items.filter((_, itemIndex) => itemIndex !== index)); }}><Text style={s.link}>移除</Text></Pressable></View>
          <Text style={[s.small, { marginTop: 5 }]}>识别类别 · {item.color || '颜色未确认'}</Text>
          {working ? <Text style={s.small}>{item.category} · 处理中</Text> : <Chips values={clothingCategories} selected={item.category} onSelect={category => { if (!pending.current) { setRecognized(items => items.map((entry, itemIndex) => itemIndex === index ? { ...entry, category } : entry)); setMissingCategories(current => current.filter(value => value !== category)); } }} />}
        </View>)}
        {!recognized.length && <Text style={s.empty}>暂未识别到可见衣物，请手动补充类别或重新选择照片。</Text>}
        <Text style={s.label}>手动补充漏识别类别</Text>
        {!working && <Chips values={clothingCategories.filter(category => !recognized.some(item => item.category === category))} selected="" onSelect={addCategory} />}
        <Text style={s.label}>确认要补齐的类别</Text>
        <Text style={s.small}>未拍到、被遮挡的类别均为未知，不代表没穿。只勾选你确认缺少的类别；天气附加外套、配饰也由你决定。</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>{clothingCategories.filter(category => !recognized.some(item => item.category === category)).map(category => <View key={category} style={{ minWidth: 120, flexGrow: 1, flexBasis: '45%', backgroundColor: missingCategories.includes(category) ? C.soft : C.bg, borderRadius: 12 }}><Checkbox label={category} checked={missingCategories.includes(category)} disabled={working} onChange={checked => setMissingCategories(current => checked ? [...current, category] : current.filter(value => value !== category))} /></View>)}</View>
        <Button title="重新选择照片" soft disabled={working} onPress={() => setStep('photo')} />
        <Button title={working ? '正在整理补齐建议…' : '确认类别并生成搭配方案'} disabled={!recognized.length || !missingCategories.length || working} onPress={() => void completeOutfit()} />
      </>}

      {step === 'results' && <>
        <View style={[s.info, { marginTop: 12 }]}><Text style={s.bold}>{weather} · {temperature}℃ · {occasion}</Text><Text style={[s.small, { marginTop: 5 }]}>以下建议依据你确认的衣物类别、所选天气与场合，以及当前账户衣橱生成。</Text></View>
        <Text style={s.title}>{plans.length} 套搭配方案</Text>
        <Text style={[s.small, { marginTop: 8 }]}>沿用本次原自拍，只添加确认缺少的单品，保留人物、背景与已有衣物。生成前显示原图，真实生成后才显示 AI 效果。</Text>
        <Chips values={plans.map((_, index) => `方案 ${index + 1}`)} selected={`方案 ${selectedPlan + 1}`} onSelect={value => { if (!previewBusy) { setSelectedPlan(Number(value.split(' ')[1]) - 1); setShowEdited(false); setPreviewConsent(false); } }} />
        {plans.slice(selectedPlan, selectedPlan + 1).map(plan => <View key={plan.plan_id} style={home.plan}>
          <View style={{ flexDirection: 'row', padding: 4, backgroundColor: C.bg, borderRadius: 14 }}>{['原自拍', 'AI 补齐效果'].map((label, index) => <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: showEdited === !!index, disabled: !!index && !previews[plan.plan_id] }} disabled={!!index && !previews[plan.plan_id]} onPress={() => setShowEdited(!!index)} style={({ pressed }) => ({ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: showEdited === !!index ? '#fff' : 'transparent', opacity: (!!index && !previews[plan.plan_id]) ? 0.4 : pressed ? 0.7 : 1 })}><Text style={[s.link, { color: showEdited === !!index ? C.primary : C.sub }]}>{label}</Text></Pressable>)}</View>
          <PreviewImage key={showEdited ? previews[plan.plan_id]?.image_url : photo?.uri} uri={showEdited ? previews[plan.plan_id]?.image_url : photo?.uri} aspectRatio={photo ? ((photo.width || 3) / (photo.height || 4)) : 3 / 4} onPress={() => setFullPreview(true)} />
          <Text style={[s.small, { marginTop: 8 }]}>方案 {selectedPlan + 1} · {showEdited && previews[plan.plan_id] ? 'AI 补齐效果' : '原自拍 · 尚未展示合成效果'} · 点击放大</Text>
          <Modal visible={fullPreview} transparent={false} onRequestClose={() => setFullPreview(false)}><View style={{ flex: 1, backgroundColor: '#171411', padding: 20 }}><Button title="关闭大图" onPress={() => setFullPreview(false)} /><PreviewImage key={showEdited ? previews[plan.plan_id]?.image_url : photo?.uri} full uri={showEdited ? previews[plan.plan_id]?.image_url : photo?.uri} /></View></Modal>
          <Text style={s.title}>{plan.title}</Text>
          <Text style={s.body}>{plan.reason}</Text>
          <View style={home.planItems}>{plan.items.map(item => <View key={item.id} style={home.planItem}>
            <View style={home.planItemPhoto}><Photo uri={item.image || undefined} square /></View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.bold}>{item.name}</Text>
              <Text style={s.small}>{item.category} · {item.status === 'visible' ? '已穿同类可保留（非同款确认）' : item.status === 'wardrobe' ? `衣橱已有 / 可复用${item.wardrobe_name ? ` · ${item.wardrobe_name}` : ''}` : '缺失 · 可按需补齐'}</Text>
              {item.status === 'missing' && (Platform.OS === 'web' ? <Link href={`https://s.taobao.com/search?q=${encodeURIComponent(item.name)}`} target="_blank" rel="noopener noreferrer" accessibilityLabel={`去淘宝搜索：${item.name}，在新页面打开`} style={[s.link, home.shoppingLink]}>去淘宝搜索 ↗</Link> : <Pressable accessibilityRole="link" accessibilityLabel={`去淘宝搜索：${item.name}`} style={home.textAction} onPress={() => void searchTaobao(item.name)}><Text style={s.link}>去淘宝搜索 ↗</Text></Pressable>)}
            </View>
          </View>)}</View>
          <Checkbox label="同意将原自拍发送给已配置的外部 AI 图片编辑服务" description="仅用于本方案生成。切换方案后需重新确认。" checked={previewConsent} onChange={setPreviewConsent} disabled={previewBusy} />
          <Button title={previewBusy ? '正在生成本方案，请勿重复提交…' : previews[plan.plan_id] ? '本方案已生成' : '在本页生成 AI 补齐预览'} disabled={!previewConsent || previewBusy || !!previews[plan.plan_id]} onPress={() => void generatePreview()} />
          {previewBusy && <Text style={s.small}>请求进行中。失败或超时不会自动重试，可能已产生服务商费用。</Text>}
          {previewErrors[plan.plan_id] && <Text accessibilityRole="alert" style={s.small}>本方案未获得结果：{previewErrors[plan.plan_id]}。不会自动重试；若服务器已提交，重复请求将被拒绝以避免再次计费。</Text>}
          {previews[plan.plan_id] && <Text style={s.small}>{previews[plan.plan_id].notice} 原自拍仅随本次请求传送，本应用不保存。</Text>}
        </View>)}
        {!!shoppingError && <Text accessibilityRole="alert" style={s.body}>{shoppingError}</Text>}
        {!plans.length && suggestions.length > 0 && <Text style={[s.bold, { marginTop: 16 }]}>类别补齐参考</Text>}
        {!plans.length && suggestions.map((suggestion, index) => <View key={`${suggestion.category}-${index}`} style={home.suggestion}>
          <View style={s.between}><Text style={s.bold}>{suggestion.category}</Text><Text style={s.tag}>建议补齐</Text></View>
          <Text style={[s.body, { marginTop: 5 }]}>{suggestion.name}</Text>
          <Text style={[s.small, { marginTop: 5 }]}>{suggestion.reason}</Text>
          {suggestion.wardrobe_item && <Text style={[s.small, { marginTop: 6, color: C.primary }]}>衣橱已有 · {suggestion.wardrobe_item.name}</Text>}
          {suggestion.catalog_item && <Text style={[s.small, { marginTop: 6, color: C.primary }]}>目录参考 · {suggestion.catalog_item.name}</Text>}
        </View>)}
        <Text style={[s.small, { marginTop: 10 }]}>{note}</Text>
        <Text style={s.small}>返回确认将保留自拍、识别衣物和穿搭条件，并清除本次方案与效果；重新获取方案后需再次同意生成，可能产生新的服务商费用。</Text>
        <Button title="返回确认，重新获取方案" soft disabled={previewBusy} onPress={returnToReviewForReconfirmation} />
        <Button title="重新开始一键补齐" soft disabled={previewBusy} onPress={openStylist} />
      </>}

      {!!flowError && <View accessibilityRole="alert" style={[s.info, { marginTop: 12 }]}><Text style={s.body}>{flowError}</Text></View>}
    </Sheet>
  </Screen>;
}

const home = StyleSheet.create({
  plan: { gap: 12, paddingTop: 24, paddingBottom: 24, borderBottomWidth: 1, borderBottomColor: C.line },
  planCover: { borderRadius: 16, overflow: 'hidden' },
  planItems: { gap: 12, marginTop: 8 },
  planItem: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  planItemPhoto: { width: 80, borderRadius: 12, overflow: 'hidden' },
  shoppingLink: { minHeight: 44, paddingVertical: 12, alignSelf: 'flex-start' },
  greeting: { gap: 8, paddingTop: 8, paddingBottom: 24 },
  profileAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 },
  greetingTitle: { ...s.title, fontSize: 28, lineHeight: 38 },
  sectionHeading: { ...s.between, marginTop: 24, marginBottom: 12, flexWrap: 'wrap' },
  textAction: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  featured: { borderRadius: 20, overflow: 'hidden', backgroundColor: '#FFFCF8', borderWidth: 1, borderColor: C.line },
  featuredLabel: { position: 'absolute', top: 16, left: 16, backgroundColor: '#FFFCF8', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, color: C.primary, fontSize: 11 },
  featuredCaption: { padding: 16, gap: 8 },
  record: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  recordPhoto: { width: 64, borderRadius: 12, overflow: 'hidden' },
  dailyEmpty: { borderLeftWidth: 2, borderLeftColor: '#D8B7A1', paddingLeft: 16, gap: 4 },
  closetStats: { flexDirection: 'row', gap: 12, paddingVertical: 16, borderTopWidth: 1, borderTopColor: C.line, marginBottom: 12 },
  statValue: { ...s.title, fontSize: 24, lineHeight: 34 },
  wardrobeRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  itemPhoto: { borderRadius: 12, overflow: 'hidden' },
  empty: { padding: 20, backgroundColor: '#EEE6DB', borderRadius: 16, gap: 4 },
  weatherCard: { padding: 16, borderRadius: 18, backgroundColor: '#FAEEE3', borderWidth: 1, borderColor: '#F0D6C5', marginBottom: 14 },
  weatherIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff8', alignItems: 'center', justifyContent: 'center' },
  weatherAction: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginTop: 4 },
  stylistCard: { padding: 16, borderRadius: 18, backgroundColor: '#EEDDD0', marginTop: 16 },
  stylistMark: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  steps: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.line, flexWrap: 'wrap' },
  activeStep: { color: C.primary, fontWeight: '600' },
  photoFrame: { marginTop: 14, alignSelf: 'center', width: '100%', maxWidth: 280, overflow: 'hidden', borderRadius: 14, backgroundColor: '#F4EEE6' },
  photo: { width: '100%', aspectRatio: 3 / 4 },
  photoEmpty: { height: 170, marginTop: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: '#FBF7F1', alignItems: 'center', justifyContent: 'center' },
  detectedItem: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#FBF7F1', borderWidth: 1, borderColor: C.line },
  suggestion: { marginTop: 10, padding: 14, borderRadius: 12, backgroundColor: '#FBF7F1', borderWidth: 1, borderColor: C.line },
});
