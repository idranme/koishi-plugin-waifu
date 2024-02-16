import { Context, Schema, h, Universal, Time } from 'koishi'
import { randomSelect, isSameDay } from './utils'
import { } from '@koishijs/cache'

export const name = 'waifu'
export const inject = ['cache']

declare module '@koishijs/cache' {
  interface Tables {
    waifu_marriages: Universal.GuildMember & { marriageDate: number }
    [key: `waifu_members_${string}`]: Universal.GuildMember
  }
}

export interface Config {
  avoidNtr: boolean
  excludeUsers: {
    uid: string
    note?: string
  }[]
}

export const Config: Schema<Config> = Schema.object({
  avoidNtr: Schema.boolean().default(false),
  excludeUsers: Schema.array(Schema.object({
    uid: Schema.string().required(),
    note: Schema.string()
  })).default([{ uid: 'red:2854196310', note: 'Q群管家' }])
}).i18n({
  'zh-CN': require('./locales/zh-CN'),
})

export function apply(ctx: Context, cfg: Config) {
  ctx.i18n.define('zh-CN', require('./locales/zh-CN'))

  ctx.guild().on('message-created', async (session) => {
    await ctx.cache.set(`waifu_members_${session.gid}`, session.userId, session.event.member, 2 * Time.day)
  })

  ctx.on('guild-member-removed', (session) => {
    ctx.cache.delete(`waifu_members_${session.gid}`, session.userId)
  })

  ctx.command('waifu', '娶群友')
    .alias('marry', '娶群友', '今日老婆')
    .action(async ({ session }) => {
      if (!session.guildId) {
        return session.text('.members-too-few')
      }

      const marriage = await ctx.cache.get('waifu_marriages', session.fid)
      if (marriage && marriage.user.id !== session.userId && isSameDay(Date.now(), marriage.marriageDate)) {
        const selected = marriage
        return session.text('.marriages', {
          quote: h.quote(session.messageId),
          name: selected.nick || selected.user.nick || selected.user.name,
          avatar: h.image(selected.avatar || selected.user.avatar)
        })
      }

      let { data, next } = await session.bot.getGuildMemberList(session.guildId)
      if (next) {
        const memberList = await session.bot.getGuildMemberList(session.guildId, next)
        data = [...data, ...memberList.data]
      }
      if (data.length === 0) {
        for await (const [, value] of ctx.cache.entries(`waifu_members_${session.gid}`)) {
          data.push(value)
        }
      }

      const excludes = cfg.excludeUsers.map(({ uid }) => uid)
      excludes.push(session.uid, session.sid)

      const list = data.filter(v => !excludes.includes(`${session.platform}:${v.user.id}`) && !v.user.isBot)
      if (list.length === 0) {
        return session.text('.members-too-few')
      }

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
}
