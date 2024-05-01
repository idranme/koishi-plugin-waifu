import { Context, Schema, h, Universal, Time } from 'koishi'
import { randomSelect, getMaxAge } from './utils'
import { } from '@koishijs/cache'

export const name = 'waifu'
export const inject = ['cache']

declare module '@koishijs/cache' {
  interface Tables {
    [key: `waifu_members_${string}`]: Universal.GuildMember
    [key: `waifu_members_active_${string}`]: string
    [key: `waifu_marriages_${string}`]: string
  }
}

export interface Config {
  avoidNtr: boolean
  onlyActiveUser: boolean
  activeDays: number
  forceMarry: boolean
  excludeUsers: {
    uid: string
    note?: string
  }[]
}

export const Config: Schema<Config> = Schema.object({
  avoidNtr: Schema.boolean().default(false),
  onlyActiveUser: Schema.boolean().default(false),
  activeDays: Schema.natural().default(7),
  forceMarry: Schema.boolean().default(false),
  excludeUsers: Schema.array(Schema.object({
    uid: Schema.string().required(),
    note: Schema.string()
  })).role('table').default([{ uid: 'red:2854196310', note: 'Q群管家' }])
}).i18n({
  'zh-CN': require('./locales/zh-CN'),
})

export function apply(ctx: Context, cfg: Config) {
  ctx.i18n.define('zh-CN', require('./locales/zh-CN'))

  // gid: platform:guildId
  // fid: platform:guildId:userId
  // sid: platform:selfId

  ctx.guild().on('message-created', async (session) => {
    const member: Universal.GuildMember = session.event.member || { user: session.event.user }
    await ctx.cache.set(`waifu_members_${session.gid}`, session.userId, member, 2 * Time.day)
    await ctx.cache.set(`waifu_members_active_${session.gid}`, session.userId, '', cfg.activeDays * Time.day)
  })

  ctx.on('guild-member-removed', (session) => {
    ctx.cache.delete(`waifu_members_${session.gid}`, session.userId)
    ctx.cache.delete(`waifu_members_active_${session.gid}`, session.userId)
  })

  ctx.command('waifu')
    .alias('marry', '娶群友', '今日老婆')
    .action(async ({ session }) => {
      if (!session.guildId) {
        return session.text('.members-too-few')
      }
      const { gid } = session

      const target = await ctx.cache.get(`waifu_marriages_${gid}`, session.userId)
      if (target) {
        let selected: Universal.GuildMember
        try {
          selected = await session.bot.getGuildMember(session.guildId, target)
        } catch { }
        try {
          selected ??= await ctx.cache.get(`waifu_members_${gid}`, target)
        } catch { }
        try {
          selected ??= { user: await session.bot.getUser(target) }
        } catch { }
        const name = selected?.nick || selected?.user?.nick || selected?.user?.name || target
        const avatar = selected?.avatar || selected?.user?.avatar
        return session.text('.marriages', {
          quote: h.quote(session.messageId),
          name,
          avatar: avatar && h.image(avatar)
        })
      }

      let memberList: Universal.GuildMember[]
      try {
        const { data, next } = await session.bot.getGuildMemberList(session.guildId)
        memberList = data
        if (next) {
          const { data } = await session.bot.getGuildMemberList(session.guildId, next)
          memberList.push(...data)
        }
      } catch { }
      if (!memberList?.length) {
        for await (const value of ctx.cache.values(`waifu_members_${gid}`)) {
          memberList.push(value)
        }
      }

      const excludes = cfg.excludeUsers.map(({ uid }) => uid)
      excludes.push(session.uid, session.sid)

      let list = memberList.filter(v => {
        return v.user && !excludes.includes(`${session.platform}:${v.user.id}`) && !v.user.isBot
      })
      if (cfg.onlyActiveUser) {
        let activeList: string[] = []
        for await (const value of ctx.cache.keys(`waifu_members_active_${gid}`)) {
          activeList.push(value)
        }
        list = list.filter(v => activeList.find(active => active === v.user.id))
      }
      if (list.length === 0) return session.text('.members-too-few')

      let selected = randomSelect(list)
      let selectedId = selected.user.id
      const selectedTarget = await ctx.cache.get(`waifu_marriages_${gid}`, selectedId)
      if (selectedTarget) {
        selected = randomSelect(list)
        selectedId = selected.user.id
      }
      if (cfg.avoidNtr) {
        let i = 0
        while (true) {
          const selectedTarget = await ctx.cache.get(`waifu_marriages_${gid}`, selectedId)
          if (selectedTarget) {
            selected = randomSelect(list)
            selectedId = selected.user.id
          } else {
            break
          }
          i++
          if (i > list.length) return session.text('.members-too-few')
        }
      }
      const maxAge = getMaxAge()
      await ctx.cache.set(`waifu_marriages_${gid}`, session.userId, selectedId, maxAge)
      await ctx.cache.set(`waifu_marriages_${gid}`, selectedId, session.userId, maxAge)

      const name = selected?.nick || selected?.user?.nick || selected?.user?.name || selectedId
      const avatar = selected?.avatar || selected?.user?.avatar
      return session.text('.marriages', {
        quote: h.quote(session.messageId),
        name,
        avatar: avatar && h.image(avatar)
      })
    })

  if (cfg.forceMarry) {
    ctx.command('force-marry <target:user>')
      .alias('强娶')
      .action(async ({ session }, target) => {
        if (!session.guildId) {
          return session.text('.members-too-few')
        }
        if (!target) {
          return session.text('.no-target', {
            quote: h.quote(session.messageId)
          })
        }

        const targetId = target.replace(session.platform + ':', '')
        if (targetId === session.userId) return session.text('.target-self')
        const { gid } = session

        const marriage = await ctx.cache.get(`waifu_marriages_${gid}`, session.userId)
        if (marriage) {
          return session.text('.already-marriage', {
            quote: h.quote(session.messageId)
          })
        }

        let memberList: Universal.GuildMember[]
        try {
          const { data, next } = await session.bot.getGuildMemberList(session.guildId)
          memberList = data
          if (next) {
            const { data } = await session.bot.getGuildMemberList(session.guildId, next)
            memberList.push(...data)
          }
        } catch { }
        if (!memberList?.length) {
          for await (const value of ctx.cache.values(`waifu_members_${gid}`)) {
            memberList.push(value)
          }
        }

        let selected = memberList.find(u => u.user.id == targetId)
        if (!selected) return session.text('.members-too-few')

        const selectedId = selected.user.id
        const maxAge = getMaxAge()
        await ctx.cache.set(`waifu_marriages_${gid}`, session.userId, selectedId, maxAge)
        await ctx.cache.set(`waifu_marriages_${gid}`, selectedId, session.userId, maxAge)

        const name = selected?.nick || selected?.user?.nick || selected?.user?.name || selectedId
        const avatar = selected?.avatar || selected?.user?.avatar
        return session.text('.force-marry', {
          quote: h.quote(session.messageId),
          name,
          avatar: avatar && h.image(avatar)
        })
      })
  }
}