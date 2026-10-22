import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, C, Icon, OutfitActions, OutfitTags, Photo, Screen, Sheet, s } from '../components/ui';
import { request, useStore, type Recommendation } from '../lib/store';

export default function Detail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { catalog, recommendations, state, mutate, busy, notify } = useStore();
  const [buy, setBuy] = useState(false);
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const [detailPlan, setDetailPlan] = useState<Recommendation | null>(null);
  const [detailError, setDetailError] = useState('');
  const plan = recommendations.find(value => value.outfit.id === id) || (detailPlan?.outfit.id === id ? detailPlan : null);
  const outfit = plan?.outfit || catalog?.outfits.find(value => value.id === id);
  useEffect(() => {
    if (!id || !catalog || recommendations.some(value => value.outfit.id === id)) return;
    const controller = new AbortController();
    void request<Recommendation>(`/api/outfits/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(result => { setDetailPlan(result); setDetailError(''); })
      .catch(error => { if (!controller.signal.aborted) setDetailError((error as Error).message); });
    return () => controller.abort();
  }, [id, catalog, recommendations]);
  if (!outfit || !plan) return <Screen><Text style={s.empty}>{detailError || '正在加载这套搭配详情…'}</Text><Button title="返回首页" onPress={() => router.replace('/')} /></Screen>;

  const missing = plan.missing.map(match => match.item);
  const total = outfit.items.reduce((sum, item) => sum + item.price, 0);
  const missingTotal = missing.reduce((sum, item) => sum + item.price, 0);
  const collected = state?.likes.includes(`outfit:${outfit.id}`) || false;

  return <Screen>
    <View style={[s.between, { height: 52 }]}>
      <Pressable style={styles.back} onPress={() => router.canGoBack() ? router.back() : router.replace('/')} accessibilityRole="button" accessibilityLabel="返回"><Icon name="back" /></Pressable>
      <Text style={s.title}>搭配详情</Text><Icon name="shirt" />
    </View>
    <View style={s.card}>
      <View><Photo uri={outfit.cover} aspectRatio={3 / 4} /><Text style={s.match}>搭配参考图</Text></View>
      <View style={s.pad}>
        <Text style={s.title}>{outfit.title}</Text>
        <OutfitTags outfit={outfit} />
        {outfit.summary && <Text style={[s.body, { marginTop: 12 }]}>{outfit.summary}</Text>}
      </View>
    </View>
    {(!!outfit.styling?.length || outfit.occasionTip) && <View style={[s.card, s.pad]}>
      <Text style={s.title}>这套怎么穿</Text>
      {outfit.styling?.map((tip, index) => <View key={tip} style={[s.row, { alignItems: 'flex-start', marginTop: 12 }]}><Text style={s.link}>{index + 1}.</Text><Text style={[s.body, { flex: 1 }]}>{tip}</Text></View>)}
      {outfit.occasionTip && <View style={[s.info, { marginTop: 16, marginBottom: 0 }]}><Text style={s.bold}>场合适配 · {outfit.occasion}</Text><Text style={[s.body, { marginTop: 4 }]}>{outfit.occasionTip}</Text></View>}
    </View>}
    <View style={[s.between, styles.heading]}><Text style={s.title}>单品清单</Text><Text style={s.small}>已有 {plan.owned_count}/{plan.total_count} 件</Text></View>
    <View style={[s.card, s.pad]}>
      {outfit.items.map(item => {
        const match = plan.matched.find(value => value.item.id === item.id);
        return <View key={item.id} style={[s.row, styles.item]}>
          <View style={styles.thumbnail}><Photo uri={item.img} square /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.bold}>{item.name}</Text>
            <Text style={s.small}>参考价 ¥{item.price}</Text>
            {match && <Text style={s.small}>衣橱：{match.wardrobe_item.name}</Text>}
            <Text style={[styles.status, match ? styles.owned : styles.missing]}>{match ? (match.exact_color ? '衣橱已有' : '已有 · 颜色待确认') : '待补齐'}</Text>
          </View>
        </View>;
      })}
      <View style={[s.between, styles.total]}><Text style={s.body}>整套参考总价</Text><Text style={styles.price}>¥{total}</Text></View>
      <View style={[s.between, { marginTop: 10, flexWrap: 'wrap' }]}><Text style={s.small}>已有 {plan.owned_count} 件 · 对应单品参考价</Text><Text style={s.bold}>¥{total - missingTotal}</Text></View>
      <View style={[s.between, { marginTop: 10, flexWrap: 'wrap' }]}><Text style={s.small}>待补齐 {missing.length} 件 · 参考总价</Text><Text style={s.bold}>¥{missingTotal}</Text></View>
      <Text style={[s.small, { marginTop: 12 }]}>已有金额按本套参考单品计价，并非衣橱购入成本；缺失预算仅供参考，请以实际商家信息为准，不会自动购买。</Text>
    </View>
    <View style={s.card}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: reasonsOpen }} onPress={() => setReasonsOpen(!reasonsOpen)} style={[s.between, s.pad, { minHeight: 48 }]}><Text style={s.bold}>为什么推荐</Text><Text style={s.link}>{reasonsOpen ? '收起 −' : '展开 +'}</Text></Pressable>
      {reasonsOpen && <View style={s.pad}>
        <Text style={s.body}>{plan.reason}</Text>
        <Text style={[s.small, { marginTop: 10 }]}>按分类、款式与颜色匹配，每件衣物在一套中仅使用一次；请以实物颜色与版型为准。</Text>
        {outfit.items.map(item => {
          const match = plan.matched.find(value => value.item.id === item.id);
          const reason = match?.reason || plan.missing.find(value => value.item.id === item.id)?.reason;
          return <View key={item.id} style={styles.item}><Text style={s.bold}>{item.name}</Text><Text style={s.small}>{reason}</Text></View>;
        })}
      </View>}
    </View>
    <OutfitActions id={outfit.id} />
    <Button title={collected ? '已收藏 · 点击取消' : '收藏'} soft={!collected} disabled={busy} onPress={() => void mutate(`/api/likes/outfit:${outfit.id}`).then(ok => { if (ok) notify(collected ? '已取消收藏' : '已收藏，可在「我的」查看'); })} />
    <Button title="AI 试穿预览" soft onPress={() => router.push({ pathname: '/tryon', params: { id: outfit.id } })} />
    <Text style={[s.small, { marginTop: 8 }]}>上传人物照生成穿搭预览，需要配置图像编辑服务；不提供尺码预测。</Text>
    <Button title="补齐缺失单品 · 演示" soft disabled={!missing.length} onPress={() => setBuy(true)} />
    <Sheet title="补齐缺失单品" visible={buy} onClose={() => setBuy(false)}>
      <Text style={[s.body, { marginTop: 14 }]}>此处为购买流程演示，不会创建商品订单或发生扣款。</Text>
      {missing.map(item => <View key={item.id} style={[s.between, s.menu]}><Text style={[s.body, { flex: 1 }]}>{item.name}</Text><Text style={s.bold}>¥{item.price}</Text></View>)}
      <View style={[s.between, { marginTop: 16 }]}><Text style={s.body}>缺失单品参考总价</Text><Text style={styles.price}>¥{missingTotal}</Text></View>
      <Text style={[s.small, { marginTop: 14 }]}>价格仅供搭配参考，请以实际商家信息为准。</Text>
      <Button title="完成演示" onPress={() => setBuy(false)} />
    </Sheet>
  </Screen>;
}

const styles = StyleSheet.create({
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  heading: { marginTop: 6, marginBottom: 14, flexWrap: 'wrap' },
  item: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  thumbnail: { width: 56, borderRadius: 10, overflow: 'hidden' },
  status: { fontSize: 11, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, overflow: 'hidden', alignSelf: 'flex-start', marginTop: 4 },
  owned: { color: '#5F8464', backgroundColor: '#EDF3E9' },
  missing: { color: C.primary, backgroundColor: C.soft },
  total: { paddingTop: 16, flexWrap: 'wrap' },
  price: { color: C.primary, fontSize: 20, fontWeight: '600' },
});
