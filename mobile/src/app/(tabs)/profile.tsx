import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, C, Field, Icon, LogoutButton, Select, Sheet, Screen, Section, s } from '../../components/ui';
import { json, useStore, type Gender, type OutfitPreference, type Plan } from '../../lib/store';
import SavedSets from '../../components/saved-sets';

export default function Profile() {
  const { user, state, catalog, activity, savedSets, mutate, busy, notify } = useStore();
  const collectedOutfits = (catalog?.outfits || []).filter(outfit => state?.likes.includes(`outfit:${outfit.id}`));
  const [sheet, setSheet] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [name, setName] = useState(user?.name || '');
  const [city, setCity] = useState(user?.city || '');
  const [email, setEmail] = useState(user?.email || '');
  const [tags, setTags] = useState(user?.tags?.join('，') || '');
  const [gender, setGender] = useState<Gender>(user?.gender || 'unspecified');
  const [outfitPreference, setOutfitPreference] = useState<OutfitPreference>(user?.outfit_preference || 'auto');
  const [height, setHeight] = useState(String(user?.height || ''));
  const [weight, setWeight] = useState(String(user?.weight || ''));
  const [waist, setWaist] = useState(String(user?.waist || ''));
  const [shape, setShape] = useState(user?.body_shape || '');
  const [now] = useState(() => Date.now());
  const active = !!state?.member_until && new Date(state.member_until).getTime() > now;
  const editProfile = () => {
    setName(user?.name || '');
    setCity(user?.city || '');
    setEmail(user?.email || '');
    setTags(user?.tags?.join('，') || '');
    setGender(user?.gender || 'unspecified');
    setOutfitPreference(user?.outfit_preference || 'auto');
    setSheet('profile');
  };
  const editBody = () => {
    setHeight(String(user?.height || ''));
    setWeight(String(user?.weight || ''));
    setWaist(String(user?.waist || ''));
    setShape(user?.body_shape || '');
    setSheet('body');
  };
  const close = () => { if (!busy) setSheet(''); };
  const openMember = () => { setPlan(null); setSheet('member'); };
  const saveProfile = async () => {
    if (!name.trim() || !city.trim()) { notify('请填写昵称与城市'); return; }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) { notify('请填写正确的邮箱地址'); return; }
    if (await mutate('/api/user/profile', json({ name: name.trim(), city: city.trim(), email: trimmedEmail, tags: tags.split(/[、,，]/).map(tag => tag.trim()).filter(Boolean), gender, outfit_preference: outfitPreference }, 'PUT'))) {
      setSheet('');
      notify('资料已更新');
    }
  };
  const saveBody = async () => {
    if (!height || !weight) { notify('请填写身高与体重'); return; }
    const h = Number(height), w = Number(weight), waistValue = Number(waist);
    if (!Number.isInteger(h) || h < 80 || h > 240 || !Number.isInteger(w) || w < 25 || w > 250 || (waist && (!Number.isInteger(waistValue) || waistValue < 30 || waistValue > 200))) {
      notify('身高需为80–240cm、体重25–250kg、腰围30–200cm的整数');
      return;
    }
    if (await mutate('/api/user/profile', json({ height: h, weight: w, body_shape: shape, ...(waist ? { waist: waistValue } : {}) }, 'PUT'))) {
      setSheet('');
      notify('身材信息已更新');
    }
  };
  const pay = async () => {
    if (!plan) return;
    if (await mutate('/api/membership', json({ plan_id: plan.id }))) {
      setPlan(null);
      setSheet('success');
    }
  };
  return <Screen>
    <Text style={s.kicker}>MY SPACE</Text>
    <View style={[s.card, s.pad, s.row, { marginTop: 14, gap: 12, alignItems: 'flex-start' }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="编辑个人资料" onPress={editProfile} style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center' }}><Icon name="user" color={C.primary} /></Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[s.title, { fontSize: 24 }]}>{user?.name}</Text>
        <Text style={s.small}>{user?.city} · {active ? '善衣会员' : '普通用户'}</Text>
        <Text style={[s.small, { marginTop: 3 }]}>{user?.height ? `${user.height} cm · ${user.weight} kg` : '身材信息待完善'} · {user?.body_shape || '体型未设置'}</Text>
        <View style={s.tags}>{(user?.tags?.length ? user.tags : ['暂无风格标签']).map(tag => <Text key={tag} style={s.tag}>{tag}</Text>)}</View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="设置中心" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }} onPress={() => setSheet('settings')}><Icon name="settings" /></Pressable>
    </View>
    <Pressable accessibilityRole="button" onPress={openMember} style={[s.card, s.pad, { backgroundColor: '#4A3F35', borderColor: '#4A3F35' }]}>
      <View style={s.between}><Text style={[s.bold, { color: '#F8EEE2' }]}>善衣会员</Text><Text style={{ color: '#F8EEE2', fontSize: 12 }}>{active ? '续期会员 →' : '查看权益与开通 →'}</Text></View>
      <Text style={[s.small, { color: '#E0CDBB', marginTop: 6 }]}>{active ? `有效至 ${new Date(state!.member_until!).toLocaleDateString()}` : '搭配分析、衣橱管理与相近身材参考'}</Text>
    </Pressable>
    <Section title="我保存的套装" en="MY SETS" />
    <Text style={[s.small, { marginBottom: 12 }]}>自己从衣橱组合并保存的 {savedSets.length} 套搭配，仅在确认分享后公开。</Text>
    <SavedSets key={user?.phone} />
    <Section title="个人资料与穿搭记录" en="PROFILE" />
    <View style={s.card}>
      <Pressable accessibilityRole="button" style={[s.between, s.menu, { minHeight: 64 }]} onPress={editProfile}><View style={{ flex: 1 }}><Text style={s.body}>修改用户信息</Text><Text style={s.small}>昵称、城市、邮箱与偏好标签</Text></View><Text style={s.link}>编辑 →</Text></Pressable>
      <Pressable accessibilityRole="button" style={[s.between, s.menu, { minHeight: 64 }]} onPress={editBody}><View style={{ flex: 1 }}><Text style={s.body}>个人身材信息</Text><Text style={s.small}>{user?.height ? `${user.height} cm · ${user.weight} kg` : '身高与体重待完善'} · {user?.body_shape || '未设置体型'}</Text></View><Text style={s.link}>编辑 →</Text></Pressable>
      <Pressable style={[s.between, s.menu]} onPress={() => setSheet('history')}><Text style={s.body}>穿搭历史</Text><Text style={s.link}>{activity.records.length} 次 →</Text></Pressable>
      <Pressable style={[s.between, s.menu]} onPress={() => setSheet('feedback')}><Text style={s.body}>我的推荐反馈</Text><Text style={s.link}>{Object.keys(activity.feedback).length} 套 →</Text></Pressable>
      <Pressable style={[s.between, s.menu]} onPress={() => setSheet('records')}><Text style={s.body}>我收藏的套装</Text><Text style={s.link}>{collectedOutfits.length} 套 →</Text></Pressable>
      <Pressable style={[s.between, s.menu]} onPress={() => setSheet('orders')}><Text style={s.body}>会员订单</Text><Text style={s.link}>{state?.orders.length || 0} 笔 →</Text></Pressable>
    </View>
    <Section title="偏好设置" en="SETTINGS" />
    <View style={s.card}>
      <Pressable accessibilityRole="button" style={[s.between, s.menu, { minHeight: 64 }]} onPress={() => setSheet('settings')}><View style={{ flex: 1 }}><Text style={s.body}>天气与城市</Text><Text style={s.small}>{user?.city} · 天气感知推荐暂未接入</Text></View><Text style={s.link}>查看 →</Text></Pressable>
      <Pressable accessibilityRole="button" style={[s.between, s.menu, { minHeight: 64 }]} onPress={() => setSheet('settings')}><View style={{ flex: 1 }}><Text style={s.body}>搭配提醒与推荐偏好</Text><Text style={s.small}>已有偏好记录会保留</Text></View><Text style={s.link}>查看 →</Text></Pressable>
    </View>
    <View style={[s.card, s.pad]}><Text style={s.bold}>关于善衣</Text><Text style={s.small}>V1.0 · 让每一件衣服都被好好穿着</Text></View>
    <View style={s.card}><Pressable accessibilityRole="button" style={[s.between, s.menu, { minHeight: 56, flexWrap: 'wrap' }]} onPress={() => router.push('/data')}><View style={{ flex: 1, minWidth: 150 }}><Text style={s.body}>衣橱备份</Text><Text style={s.small}>导出副本 · 从备份恢复</Text></View><Text style={s.link}>管理 →</Text></Pressable></View>
    <LogoutButton />

    <Sheet title="个人资料" visible={sheet === 'profile'} onClose={close}>
      <Text style={[s.small, { marginTop: 14 }]}>认证手机号：{user?.phone}</Text>
      <Field label="昵称" value={name} onChangeText={setName} />
      <Field label="城市" value={city} onChangeText={setCity} />
      <Select label="性别" values={['男', '女', '不指定']} selected={gender === 'male' ? '男' : gender === 'female' ? '女' : '不指定'} onSelect={value => setGender(value === '男' ? 'male' : value === '女' ? 'female' : 'unspecified')} />
      <Select label="穿搭偏好" values={['自动跟随性别', '男装', '女装', '中性穿搭', '全部']} selected={({ auto: '自动跟随性别', male: '男装', female: '女装', unisex: '中性穿搭', all: '全部' } as Record<OutfitPreference, string>)[outfitPreference]} onSelect={value => setOutfitPreference(({ '自动跟随性别': 'auto', '男装': 'male', '女装': 'female', '中性穿搭': 'unisex', '全部': 'all' } as Record<string, OutfitPreference>)[value])} />
      <Text style={[s.small, { marginTop: 6 }]}>自动模式下，男/女会跟随性别；未指定性别时不限制受众。手动偏好会覆盖性别设置。</Text>
      <Field label="邮箱（选填）" value={email} onChangeText={setEmail} email />
      <Field label="风格标签（逗号分隔）" value={tags} onChangeText={setTags} />
      <Button title={busy ? '保存中…' : '保存资料'} onPress={() => void saveProfile()} disabled={busy} />
    </Sheet>
    <Sheet title="个人身材信息" visible={sheet === 'body'} onClose={close}>
      <Field label="身高（cm）" value={height} onChangeText={setHeight} numeric />
      <Field label="体重（kg）" value={weight} onChangeText={setWeight} numeric />
      <Field label="腰围（cm，可选）" value={waist} onChangeText={setWaist} numeric />
      <Select label="体型" values={['梨形', '苹果形', '沙漏形', '直筒形', '倒三角形']} selected={shape} onSelect={setShape} />
      <Button title={busy ? '保存中…' : '保存身材信息'} onPress={() => void saveBody()} disabled={busy} />
    </Sheet>
    <Sheet title="设置中心" visible={sheet === 'settings'} onClose={close}>
      <Pressable style={[s.between, s.menu]} onPress={editProfile}><Text style={s.body}>所在城市</Text><Text style={s.link}>{user?.city} · 修改 →</Text></Pressable>
      {['天气感知推荐', '穿搭提醒', '推荐模式'].map(label => <View key={label} style={[s.between, s.pad]}><Text style={s.body}>{label}</Text><Text style={s.small}>暂未开放</Text></View>)}
      <Text style={s.small}>以上功能尚未接入，暂不可设置；已有偏好记录保留。</Text>
    </Sheet>
    <Sheet title={plan ? '确认模拟订单' : '善衣会员'} visible={sheet === 'member'} onClose={close}>
      {plan ? <>
        <Text style={s.title}>{plan.name} · ¥{plan.price}</Text>
        <Text style={[s.body, { marginTop: 14 }]}>{plan.days} 天会员。{active ? '将在现有有效期后延长。' : '模拟支付成功后生效。'}</Text>
        <Text style={[s.small, { marginTop: 14 }]}>此流程为模拟支付，不收取真实费用，不需要提供支付信息。</Text>
        <Button title={busy ? '正在处理…' : '确认模拟支付'} disabled={busy} onPress={() => void pay()} />
        <Button title="重新选择套餐" soft disabled={busy} onPress={() => setPlan(null)} />
      </> : <>
        <View style={[s.info, { marginTop: 14 }]}><Text style={s.bold}>{active ? '善衣会员 · 权益已开通' : '开启会员体验'}</Text><Text style={s.small}>{state?.member_until ? `有效至 ${new Date(state.member_until).toLocaleDateString()}` : '选择适合你的套餐，开启穿搭体验'}</Text></View>
        <Section title="会员权益" en="BENEFITS" />
        {catalog?.membershipBenefits.map(benefit => <View key={benefit.title} style={[s.row, { marginBottom: 13 }]}><Icon name={benefit.icon} color={C.primary} /><View style={{ flex: 1 }}><Text style={s.bold}>{benefit.title}</Text><Text style={s.small}>{benefit.detail}</Text></View></View>)}
        <Section title={active ? '续期套餐' : '开通套餐'} en="PLANS" />
        {catalog?.membershipPlans.map(item => <Pressable accessibilityRole="button" key={item.id} disabled={busy} onPress={() => setPlan(item)} style={[s.card, s.pad]}><View style={s.between}><Text style={s.bold}>{item.name}</Text><Text style={s.link}>¥{item.price} · {active ? '续期' : '购买'} →</Text></View><Text style={s.small}>{item.days} 天 · {item.note}</Text></Pressable>)}
        <Text style={s.small}>全部套餐均为模拟支付体验。</Text>
        <Button title="查看会员订单" soft onPress={() => setSheet('orders')} />
      </>}
    </Sheet>
    <Sheet title="模拟支付成功" visible={sheet === 'success'} onClose={close}>
      <Text style={s.body}>会员权益已同步，未发生真实扣款。</Text>
      <Text style={s.small}>有效至 {state?.member_until ? new Date(state.member_until).toLocaleString() : ''}</Text>
      <Button title="查看会员权益" onPress={openMember} />
      <Button title="完成" soft onPress={close} />
    </Sheet>
    <Sheet title="穿搭历史" visible={sheet === 'history'} onClose={close}>
      <Text style={[s.small, { marginVertical: 12 }]}>按北京时间记录。以下为穿着时的衣物快照，编辑或删除衣物不会改变历史。</Text>
      {activity.records.map(record => <View key={record.id} style={[s.card, s.pad]}>
        <Text style={s.small}>{record.date}{record.date === activity.today ? ' · 今天' : ''}</Text>
        <Pressable onPress={() => { setSheet(''); router.push({ pathname: '/set-detail', params: { id: record.outfit_id } }); }}><Text style={s.bold}>{record.outfit.title} →</Text></Pressable>
        {record.items.map(item => <Text key={item.id} style={s.body}>{item.name} · {[item.category, item.color].filter(Boolean).join(' / ')}</Text>)}
        {!record.items.length && <Text style={s.small}>当时暂无匹配衣橱衣物，仅记录搭配。</Text>}
        {!!record.missing.length && <Text style={s.small}>当时未匹配：{record.missing.join('、')}（未计次）</Text>}
      </View>)}
      {!activity.records.length && <Text style={s.empty}>还没有穿搭记录，在推荐或详情中标记今天已穿吧。</Text>}
    </Sheet>
    <Sheet title="我的推荐反馈" visible={sheet === 'feedback'} onClose={close}>
      <Text style={s.small}>只影响推荐排序，与套装收藏、社区点赞分开；不感兴趣的搭配仍可打开或取消反馈。</Text>
      {Object.entries(activity.feedback).map(([id, preference]) => <View key={id} style={s.menu}>
        <Pressable onPress={() => { setSheet(''); router.push({ pathname: '/set-detail', params: { id } }); }}><Text style={s.body}>{catalog?.outfits.find(outfit => outfit.id === id)?.title || id} →</Text></Pressable>
        <View style={s.between}><Text style={s.small}>{preference === 'like' ? '已喜欢' : '不感兴趣'}</Text><Button title="取消反馈" soft disabled={busy} onPress={() => void mutate(`/api/outfit-feedback/${id}`, json({ preference: null }, 'PUT'))} /></View>
      </View>)}
      {!Object.keys(activity.feedback).length && <Text style={s.empty}>暂无推荐反馈</Text>}
    </Sheet>
    <Sheet title="我收藏的套装" visible={sheet === 'records'} onClose={close}>
      <Text style={s.small}>收藏来自搭配灵感库，与推荐喜欢反馈分开保存。</Text>
      {collectedOutfits.map(outfit => <View key={outfit.id} style={s.menu}>
        <Pressable accessibilityRole="button" onPress={() => { setSheet(''); router.push({ pathname: '/set-detail', params: { id: outfit.id } }); }}><Text style={s.body}>{outfit.title} →</Text></Pressable>
        <Button title="取消收藏" soft disabled={busy} onPress={() => void mutate(`/api/likes/outfit:${outfit.id}`).then(ok => { if (ok) notify(`已取消收藏「${outfit.title}」`); })} />
      </View>)}
      {!collectedOutfits.length && <Text style={s.empty}>还没有收藏的套装，去推荐页挑选一套吧。</Text>}
    </Sheet>
    <Sheet title="会员订单" visible={sheet === 'orders'} onClose={close}>
      {[...(state?.orders || [])].reverse().map(order => <View key={order.id} style={[s.card, s.pad]}><Text style={s.bold}>{order.plan_name} · ¥{order.price} · {order.renewal ? '续期' : '开通'}</Text><Text style={s.small}>订单号：{order.id}</Text><Text style={s.small}>{new Date(order.created_at).toLocaleString()}</Text><Text style={s.small}>有效至 {new Date(order.expires_at).toLocaleDateString()}</Text><Text style={s.link}>{order.message}</Text></View>)}
      {!state?.orders.length && <Text style={s.empty}>暂无会员订单</Text>}
    </Sheet>
  </Screen>;
}
