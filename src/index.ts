import { Context, Schema, h, Universal } from 'koishi'
import { randomSelect, isSameDay } from './utils'

export const name = 'waifu'

export interface Config { }

export const Config: Schema<Config> = Schema.object({})

export function apply(ctx: Context) {
  ctx.i18n.define('zh-CN', require('./locales/zh-CN'))

  const members: Map<string, Map<string, Universal.GuildMember>> = new Map()
  const marriages: Map<string, Universal.GuildMember & { marriageDate: number }> = new Map()

  ctx.guild().middleware(async (session, next) => {
    const guildMembers = members.get(session.gid)
    if (guildMembers) {
      guildMembers.set(session.fid, session.event.member)
    } else {
      members.set(session.gid, new Map().set(session.fid, session.event.member))
    }

    return next()
  })

  ctx.on('guild-member-removed', (session) => {
    const guildMembers = members.get(session.gid)
    if (guildMembers) guildMembers.delete(session.fid)
  })

  ctx.guild().command('waifu', '娶群友')
    .alias('marry', '娶群友')
    .action(async ({ session }) => {
      const marriage = marriages.get(session.fid)
      if (marriage && isSameDay(Date.now(), marriage.marriageDate)) {
        const selected = marriage
        return session.text('.marriages', {
          quote: h('quote', { id: session.messageId }),
          name: selected.nick || selected.user.nick || selected.user.name,
          avatar: h.image(selected.avatar || selected.user.avatar)
        })
      }

      let { data } = await session.bot.getGuildMemberList(session.guildId)
      const guildMembers = members.get(session.gid)
      if (data.length === 0 && guildMembers) {
        for (const [key, value] of guildMembers) {
          data.push(value)
        }
      } else if (guildMembers) {
        const map = new Map(data.map(v => {
          const fid = `${session.platform}:${session.guildId}:${v.user.id}`
          return [fid, v]
        }))
        members.set(session.gid, map)
      }

      const excludes = [
        session.userId,
        session.selfId
      ]
      const list = data.filter(v => !excludes.includes(v.user.id))
      if (list.length === 0) {
        return session.text('.members-too-few')
      }

      const selected = randomSelect(list)
      const marriageDate = Date.now()
      marriages.set(session.fid, { ...selected, marriageDate })
      const selectedFid = `${session.platform}:${session.guildId}:${selected.user.id}`
      marriages.set(selectedFid, { ...session.event.member, marriageDate })

      return session.text('.marriages', {
        quote: h('quote', { id: session.messageId }),
        name: selected.nick || selected.user.nick || selected.user.name,
        avatar: h.image(selected.avatar ?? selected.user.avatar)
      })
    })
}
