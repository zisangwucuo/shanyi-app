import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, C, Chips, Field, Icon, Photo, Screen, Section, Select, Sheet, s } from '../components/ui';
import { useStore } from '../lib/store';

export default function Tryon() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { catalog, user, notify } = useStore();
  const [height, setHeight] = useState(String(user?.height || 162));
  const [weight, setWeight] = useState(String(user?.weight || 52));
  const [reference, setReference] = useState('我的身材');
  const [size, setSize] = useState('M');
  const [selected, setSelected] = useState<number | null>(null);
  const [generated, setGenerated] = useState(false);
  const outfit = catalog?.outfits.find(x => x.id === id);
  const validBody = Number.isFinite(Number(height)) && Number(height) >= 80 && Number(height) <= 240 && Number.isFinite(Number(weight)) && Number(weight) >= 25 && Number(weight) <= 250;
  const reviews = useMemo(() => (catalog?.reviews || []).map((review, index) => ({ ...review, index })).sort((a, b) => Math.abs(a.height - Number(height)) + Math.abs(a.weight - Number(weight)) - Math.abs(b.height - Number(height)) - Math.abs(b.weight - Number(weight))), [catalog, height, weight]);
  const review = reviews.find(item => item.index === selected) || reviews[0];
  const referenceOptions = (catalog?.reviews || []).map((item, index) => `参考 ${index + 1} · ${item.height}cm / ${item.weight}kg`);

  return <Screen>
    <View style={[s.between, { height: 52 }]}>
      <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/')} accessibilityRole="button" accessibilityLabel="返回" hitSlop={12}><Icon name="back" /></Pressable>
      <Text style={s.title}>试穿参考</Text><Icon name="user" />
    </View>
    <Text style={[s.small, { marginBottom: 14 }]}>演示功能 · 使用目录参考图片，非真实 AI 合成，不生成真实上身效果。</Text>
    <View style={[s.card, s.pad, styles.bodyCard]}>
      <View style={s.between}><Text style={s.bold}>我的身材信息</Text>{user?.city ? <Text style={s.tag}>{user.city}</Text> : null}</View>
      <Text style={[s.small, { marginTop: 8 }]}>{height || '—'} 厘米 · {weight || '—'} 千克{user?.body_shape ? ` · ${user.body_shape}` : ''}</Text>
      <View style={s.row}>
        <View style={{ flex: 1 }}><Field label="身高（厘米）" value={height} onChangeText={value => { setHeight(value); setSelected(null); setReference('自定义身材'); }} numeric /></View>
        <View style={{ flex: 1 }}><Field label="体重（千克）" value={weight} onChangeText={value => { setWeight(value); setSelected(null); setReference('自定义身材'); }} numeric /></View>
      </View>
      <Select label="参考身材" values={['我的身材', ...referenceOptions]} selected={reference} onSelect={value => {
        const index = referenceOptions.indexOf(value);
        const body = index < 0 ? user : catalog?.reviews[index];
        setHeight(String(body?.height || 162));
        setWeight(String(body?.weight || 52));
        setReference(value);
        setSelected(index < 0 ? null : index);
      }} />
      <Text style={[s.small, { marginTop: 10 }]}>调整仅用于本页演示，不保存身材信息。</Text>
    </View>
    <View style={[s.card, s.pad, styles.sizeCard]}>
      <View style={s.row}><Icon name="shirt" color={C.primary} /><Text style={s.bold}>尺码建议</Text><Text style={[s.tag, styles.accent]}>反馈参考 · 演示</Text></View>
      {validBody && reviews[0] ? <>
        <View style={[s.row, { marginTop: 12 }]}><Text style={s.body}>相近身材参考尺码</Text><Text style={styles.size}>{reviews[0].size}</Text></View>
        <Text style={s.small}>来自 {reviews[0].height}cm / {reviews[0].weight}kg 的目录反馈：{reviews[0].fit}</Text>
      </> : <Text style={[s.body, { marginTop: 12 }]}>{validBody ? '暂无尺码反馈可供参考' : '请填写有效身高和体重以查看参考'}</Text>}
      <Text style={[s.small, { marginTop: 8 }]}>按身高、体重差值排序，仅参考演示反馈；并非尺码预测，请结合商品尺码表判断松紧与版型。</Text>
    </View>
    <View style={[s.between, { marginVertical: 16 }]}>
      <Text style={s.title}>相近身材买家秀</Text>
      {outfit && <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/set-detail', params: { id: outfit.id } })}><Text style={s.link}>查看套装 →</Text></Pressable>}
    </View>
    <Text style={[s.small, { marginBottom: 12 }]}>目录演示图片与反馈，不代表真实买家实拍。点击选中参考。</Text>
    <View style={styles.grid}>
      {reviews.map(item => {
        const active = review?.index === item.index;
        return <Pressable key={`${item.index}:${item.img}`} accessibilityRole="button" accessibilityLabel={`${item.height}厘米，${item.weight}千克，${item.size}码，${item.fit}`} accessibilityState={{ selected: active }} onPress={() => setSelected(item.index)} style={[s.card, styles.review, active && styles.selected]}>
          <Photo uri={item.img} aspectRatio={3 / 4} />
          <View style={styles.reviewBody}>
            <Text style={styles.measurement}>{item.height}cm · {item.weight}kg</Text>
            <View style={[s.between, { marginTop: 6, flexWrap: 'wrap' }]}><Text style={s.small}>试穿 {item.size} 码</Text><Text style={[styles.fit, item.fit === '合适' ? styles.fitOk : styles.fitOther]}>{item.fit}</Text></View>
            <Text style={[s.small, { color: C.ink, marginTop: 8 }]}>{item.note}</Text>
            <Text style={[s.link, { marginTop: 8 }]}>{active ? '已选中参考' : '选择这张参考'}</Text>
          </View>
        </Pressable>;
      })}
    </View>
    {!reviews.length && <Text style={s.empty}>暂无相近身材参考图片</Text>}
    <Section title="选择参考尺码" en="SIZE" />
    <Chips values={['XS', 'S', 'M', 'L', 'XL']} selected={size} onSelect={setSize} />
    {review && <Text style={s.small}>当前选中：{review.height}cm / {review.weight}kg · {review.size} 码 · {review.fit}</Text>}
    <Button title="生成试穿参考 · 演示" disabled={!outfit?.cover && !review?.img} onPress={() => {
      if (!validBody) { notify('请输入有效的身高（80–240cm）和体重（25–250kg）'); return; }
      setGenerated(true);
    }} />
    <Text style={[s.small, { marginTop: 14 }]}>演示仅展示现有目录搭配图与所选参考，不会根据身材或尺码生成新图片。</Text>
    <Sheet title="试穿演示结果" visible={generated} onClose={() => setGenerated(false)}>
      <Photo uri={outfit?.cover || review?.img} aspectRatio={3 / 4} />
      <Text style={[s.body, { marginTop: 14 }]}>{outfit?.title || '搭配参考'} · 所选参考尺码 {size}</Text>
      <Text style={s.small}>这是目录图片的演示展示，非真实 AI 合成，未将衣物合成至你的身体照片，不能代表真实上身效果。</Text>
      {review && <View style={{ marginTop: 16 }}>
        <Text style={[s.bold, { marginBottom: 10 }]}>你选中的身材参考 · 演示</Text>
        <Photo uri={review.img} aspectRatio={3 / 4} />
        <Text style={[s.body, { marginTop: 10 }]}>{review.height}cm / {review.weight}kg · {review.size} 码 · {review.fit}</Text>
        <Text style={s.small}>{review.note}</Text>
      </View>}
      <Button title="返回参考" onPress={() => setGenerated(false)} />
    </Sheet>
  </Screen>;
}

const styles = StyleSheet.create({
  bodyCard: { backgroundColor: '#F8EEE3', borderColor: '#E8D9C8' },
  sizeCard: { backgroundColor: '#F6E3D8', borderColor: '#EAD0BF' },
  accent: { color: C.primary, backgroundColor: '#FFF6ED', flexShrink: 1 },
  size: { color: C.primary, fontSize: 30, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' },
  review: { width: '48%', flexGrow: 1, maxWidth: '49%', marginBottom: 0, borderWidth: 2 },
  selected: { borderColor: C.primary },
  reviewBody: { padding: 10 },
  measurement: { color: C.ink, fontSize: 12, fontWeight: '600' },
  fit: { fontSize: 10, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  fitOk: { color: '#5F8464', backgroundColor: '#EDF3E9' },
  fitOther: { color: C.primary, backgroundColor: C.soft },
});
