import { Context, Schema, h, Universal, Time, Session } from 'koishi'
import { randomSelect, isSameDay } from './utils'
import { } from '@koishijs/cache'

export const name = 'waifu'
export const inject = ['cache']

declare module '@koishijs/cache' {
  interface Tables {
    waifu_marriages: Universal.GuildMember & { marriageDate: number }
    [key: `waifu_members_${string}`]: Universal.GuildMember
    [key: `waifu_members_active_${string}`]: Universal.GuildMember
  }
}

export interface Config {
  avoidNtr: boolean
  onlyActiveUser: boolean
  activeDays: number
  forceMarry: boolean
  allowDivorce: boolean
  excludeUsers: {
    uid: string
    note?: string
  }[]
}

export const Config: Schema<Config> = Schema.object({
  avoidNtr: Schema.boolean().default(false),
  onlyActiveUser: Schema.boolean().default(false),
  activeDays: Schema.number().default(7),
  forceMarry: Schema.boolean().default(false),
  allowDivorce: Schema.boolean().default(false),
  excludeUsers: Schema.array(Schema.object({
    uid: Schema.string().required(),
    note: Schema.string()
  })).default([{ uid: 'red:2854196310', note: 'Q群管家' }])
}).i18n({
  'zh-CN': require('./locales/zh-CN'),
})

export function apply(ctx: Context, cfg: Config) {
  ctx.i18n.define('zh-CN', require('./locales/zh-CN'))

  // 成员列表暂存
  let allMemberList = {}
  // gid: platform:guildId
  // fid: platform:guildId:userId
  // sid: platform:selfId

  ctx.middleware((session, next) => {
    const { content } = session.event?.message
    if (!content) return    
    if (content.startsWith('强娶') || content.startsWith('娶群友') || content.startsWith('force_marry')) return forceMarry(session)
  })

  ctx.guild().on('message-created', async (session) => {
    const member: Universal.GuildMember = session.event.member || { user: session.event.user }
    await ctx.cache.set(`waifu_members_${session.gid}`, session.userId, member, 2 * Time.day)
    await ctx.cache.set(`waifu_members_active_${session.gid}`, session.userId, member, cfg.activeDays * Time.day)
  })

  ctx.on('guild-member-removed', (session) => {
    ctx.cache.delete(`waifu_members_${session.gid}`, session.userId)
    ctx.cache.delete(`waifu_members_active_${session.gid}`, session.userId)
    
    if (!allMemberList[session.gid]) allMemberList[session.gid] = {}
    delete allMemberList[session.gid][session.userId]
  })

  ctx.on('guild-member-added', (session) => {
    if (!allMemberList[session.gid]) allMemberList[session.gid] = {}
    allMemberList[session.gid][session.userId] = session.event.user
  })

  ctx.command('waifu', '娶群友')
    .alias('marry', '娶群友', '今日老婆')
    .action(async ({ session }) => {
      if (!session.guildId) {
        return session.text('.members-too-few')
      }

      const marriage = await ctx.cache.get('waifu_marriages', session.fid)
      if (marriage && isSameDay(Date.now(), marriage.marriageDate)) {
        const selected = marriage
        return session.text('.already-marriage', {
          quote: h.quote(session.messageId),
          name: selected.nick || selected.user.nick || selected.user.name,
          avatar: h.image(selected.avatar || selected.user.avatar)
        })
      }

      let memberList: { [key:string]: Universal.GuildMember } = allMemberList[session.guildId]
      if (!memberList || (Object.keys(memberList).length === 0)) {
        memberList = {}
        try {        
          let { data, next } = await session.bot.getGuildMemberList(session.guildId)
          data.forEach(u => memberList[u.user.id] = u)
          while (next) {
            let loopResult = await session.bot.getGuildMemberList(session.guildId, next)
            next = loopResult.next
            loopResult.data.forEach(u => memberList[u.user.id] = u)
          }
        } catch { }
        if (!memberList || (Object.keys(memberList).length === 0)) {
          for await (const [, value] of ctx.cache.entries(`waifu_members_${session.gid}`)) {
            memberList[value.user.id] = value
          }
        }
      }
      allMemberList[session.guildId] = memberList

      const excludes = cfg.excludeUsers.map(({ uid }) => uid)
      excludes.push(session.uid, session.sid)
      excludes.forEach(ex => delete memberList[ex])

      let list = Object.keys(memberList).map(member => memberList[member])

      if (list.length === 0) {
        return session.text('.members-too-few')
      }

      if (cfg.onlyActiveUser) {
        let activeList = []
        for await (const [, value] of ctx.cache.entries(`waifu_members_active_${session.gid}`)) {
          activeList.push(value)
        }
        list = list.filter(v => activeList.find(active => active.user.id === v.user.id))
      }

      if (list.length === 0) return session.text('.members-too-few')

      let selected = randomSelect(list)
      let selectedFid = `${session.platform}:${session.guildId}:${selected.user.id}`
      const selectedMarriage = await ctx.cache.get('waifu_marriages', selectedFid)
      if (selectedMarriage && isSameDay(Date.now(), selectedMarriage.marriageDate)) {
        selected = randomSelect(list)
        selectedFid = `${session.platform}:${session.guildId}:${selected.user.id}`
      }
      if (cfg.avoidNtr) {
        let i = 0
        while (true) {
          const selectedMarriage = await ctx.cache.get('waifu_marriages', selectedFid)
          if (selectedMarriage && isSameDay(Date.now(), selectedMarriage.marriageDate)) {
            selected = randomSelect(list)
            selectedFid = `${session.platform}:${session.guildId}:${selected.user.id}`
          } else {
            break
          }
          i++
          if (i > list.length) return session.text('.members-too-few')
        }
      }
      const marriageDate = Date.now()
      await ctx.cache.set('waifu_marriages', session.fid, { ...selected, marriageDate }, Time.day)
      await ctx.cache.set('waifu_marriages', selectedFid, { ...session.event.member, marriageDate }, Time.day)

      return session.text('.marriages', {
        quote: h.quote(session.messageId),
        name: selected.nick || selected.user.nick || selected.user.name,
        avatar: h.image(selected.avatar || selected.user.avatar)
      })
    })

  ctx.command('divorce', '闹离婚')
  .alias('分手', '闹离婚', '离婚')
  .action(async ({ session }) => {
    const marriage = await ctx.cache.get('waifu_marriages', session.fid)
    if (marriage && isSameDay(Date.now(), marriage.marriageDate)) {
      // 确定有老婆再说不可以离婚
      if (!cfg.allowDivorce) return session.text('.no-divorce')
      await ctx.cache.delete('waifu_marriages', session.fid)
      let selectedFid = `${session.platform}:${session.guildId}:${marriage.user?.id}`
      await ctx.cache.delete('waifu_marriages', selectedFid)
      return session.text('.divorce', { quote: h.quote(session.messageId) })
    } else {
      return session.text('.no-marriage', { quote: h.quote(session.messageId) })
    }
  })

  async function forceMarry(session: Session<never, never, Context>) {
    ctx.i18n.define('zh-CN', require('./locales/zh-CN'))
    const message = session.event?.message
    const target = message?.content.match(/id="(\d+?)"/)

    // 没有指定对象
    if (target == null)
      return session.text('.no-target', { quote: h.quote(session.messageId) })

    // 不可以娶自己
    const targetId = target[1]
    if (targetId === session.event.user.id) 
      return session.text('no-self', { quote: h.quote(session.messageId) })

    // 获取成员列表
    let memberList: { [key:string]: Universal.GuildMember } = allMemberList[session.guildId]
    if (!memberList || (Object.keys(memberList).length === 0)) {
      memberList = {}
      try {        
        let { data, next } = await session.bot.getGuildMemberList(session.guildId)
        data.forEach(u => memberList[u.user.id] = u)
        while (next) {
          let loopResult = await session.bot.getGuildMemberList(session.guildId, next)
          next = loopResult.next
          loopResult.data.forEach(u => memberList[u.user.id] = u)
        }
      } catch { }
      if (!memberList || (Object.keys(memberList).length === 0)) {
        for await (const [, value] of ctx.cache.entries(`waifu_members_${session.gid}`)) {
          memberList[value.user.id] = value
        }
      }
    }
    allMemberList[session.guildId] = memberList
    
    let list = Object.keys(memberList).map(member => memberList[member])
    const marriageDate = Date.now()

    // 不允许离婚并且有老婆时不可以强娶
    if (!cfg.allowDivorce) {
      const marriage = await ctx.cache.get('waifu_marriages', session.fid)
      if (marriage && isSameDay(Date.now(), marriage.marriageDate)) {
        if (!cfg.allowDivorce) return session.text('already-marriage', { 
          quote: h.quote(session.messageId),
          name:  marriage.name || marriage.user.name
        })
      }
    }
    let selected = list.find(u => u.user.id == targetId)
    await ctx.cache.set('waifu_marriages', session.fid, { ...selected, marriageDate }, Time.day)
    return session.text('force-marry', {
      quote: h.quote(session.messageId),
      name: selected?.nick || selected?.user?.nick || selected?.user?.name,
      avatar: h.image(selected.avatar || selected.user.avatar)
    })
  }

  if (cfg.forceMarry) {
    ctx.command('force_marry', '强娶')
    .alias('force_marry', '强娶')
    .action(async ({ session }) => forceMarry(session))
  }
}
