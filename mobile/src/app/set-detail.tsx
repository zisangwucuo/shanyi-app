import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, C, Icon, Photo, Screen, Sheet, s } from '../components/ui';
import { useStore } from '../lib/store';

export default function Detail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { catalog, owned, state, mutate, busy } = useStore();
  const [buy, setBuy] = useState(false);
  const outfit = catalog?.outfits.find(x => x.id === id);
  if (!outfit) return <Screen><Text style={s.empty}>未找到这套搭配</Text><Button title="返回首页" onPress={() => router.replace('/')} /></Screen>;

  const missing = outfit.items.filter(item => !owned(item.name));
  const total = outfit.items.reduce((sum, item) => sum + item.price, 0);
  const missingTotal = missing.reduce((sum, item) => sum + item.price, 0);
  const adopted = state?.adopted.includes(outfit.id);

  return <Screen>
    <View style={[s.between, { height: 52 }]}>
      <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/')} accessibilityRole="button" accessibilityLabel="返回" hitSlop={12}><Icon name="back" /></Pressable>
      <Text style={s.title}>搭配详情</Text><Icon name="shirt" />
    </View>
    <View style={s.card}>
      <View><Photo uri={outfit.cover} aspectRatio={3 / 4} /><Text style={s.match}>匹配 {outfit.match}%</Text></View>
      <View style={s.pad}>
        <Text style={s.title}>{outfit.title}</Text>
        <View style={s.tags}>
          <Text style={[s.tag, styles.occasion]}>{outfit.occasion}</Text>
          {outfit.tags.map(tag => <Text key={tag} style={s.tag}>{tag}</Text>)}
        </View>
      </View>
    </View>
    <View style={[s.between, styles.heading]}><Text style={s.title}>单品清单</Text><Text style={s.small}>已有 {outfit.items.length - missing.length} / 共 {outfit.items.length} 件</Text></View>
    <View style={[s.card, s.pad]}>
      {outfit.items.map(item => {
        const hasItem = owned(item.name);
        return <View key={item.id} style={[s.row, styles.item]}>
          <View style={styles.thumbnail}><Photo uri={item.img} square /></View>
          <View style={{ flex: 1 }}><Text style={s.bold}>{item.name}</Text><Text style={s.small}>参考价 ¥{item.price}</Text></View>
          <Text style={[styles.status, hasItem ? styles.owned : styles.missing]}>{hasItem ? '衣橱已有' : '待补齐'}</Text>
        </View>;
      })}
      <View style={[s.between, styles.total]}><Text style={s.body}>整套参考总价</Text><Text style={styles.price}>¥{total}</Text></View>
      <View style={[s.between, { marginTop: 10 }]}><Text style={s.small}>缺失 {missing.length} 件 · 参考总价</Text><Text style={s.bold}>¥{missingTotal}</Text></View>
      {!missing.length && <Text style={[s.small, { marginTop: 8 }]}>这套单品已全部拥有，无需补齐。</Text>}
    </View>
    <Button title={adopted ? '已采纳这套搭配' : '采纳搭配'} disabled={busy || adopted} onPress={() => void mutate(`/api/adopt/${outfit.id}`)} />
    <Button title="参考身材与试穿" soft onPress={() => router.push({ pathname: '/tryon', params: { id: outfit.id } })} />
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
  occasion: { color: C.primary, backgroundColor: C.soft },
  heading: { marginTop: 6, marginBottom: 14 },
  item: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  thumbnail: { width: 64, borderRadius: 10, overflow: 'hidden' },
  status: { fontSize: 10, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, overflow: 'hidden' },
  owned: { color: '#5F8464', backgroundColor: '#EDF3E9' },
  missing: { color: C.primary, backgroundColor: C.soft },
  total: { paddingTop: 16 },
  price: { color: C.primary, fontSize: 20, fontWeight: '600' },
});
