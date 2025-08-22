import { Context, Schema, h, Universal, Time, isNullable, Random, Session } from 'koishi'
import { getMaxAge } from './utils'
import { } from '@koishijs/cache'

export const name = 'waifu'
export const inject = {
  required: ['cache'],
  optional: ['database']
}

declare module '@koishijs/cache' {
  interface Tables {
    [key: `waifu_members_${string}`]: Universal.GuildMember

    [key: `waifu_members_active_${string}`]: string

    [key: `waifu_marriages_${string}`]: string

    [key: `waifu_times_${string}`]: number
  }
}

export interface Config {
  avoidNtr: boolean
  onlyActiveUser: boolean
  activeDays: number
  excludeUsers: {
    uid: string
    note?: string
  }[]
  maxTimes: number
  forceMarry: boolean
  propose: boolean
  divorce: boolean
  changeWaifu: boolean
  waifuQuery: boolean
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    avoidNtr: Schema.boolean().default(false),
    onlyActiveUser: Schema.boolean().default(false),
    activeDays: Schema.natural().default(7),
    excludeUsers: Schema.array(Schema.object({
      uid: Schema.string().required(),
      note: Schema.string()
    })).role('table').default([{ uid: 'red:2854196310', note: 'Q群管家' }]),
    maxTimes: Schema.natural().default(2)
  }).i18n({
    'zh-CN': require('./locales/zh-CN'),
  }),
  Schema.object({
    forceMarry: Schema.boolean().description('是否启用强娶指令').default(false),
    propose: Schema.boolean().description('是否启用求婚指令').default(false),
    divorce: Schema.boolean().description('是否启用离婚指令').default(false),
    changeWaifu: Schema.boolean().description('是否启用换老婆指令').experimental().default(false),
    waifuQuery: Schema.boolean().description('是否启用查老婆指令').experimental().default(false)
  }).description('附加指令')
])

export function apply(ctx: Context, cfg: Config) {
  ctx.i18n.define('zh-CN', require('./locales/zh-CN'))

  // gid: platform:guildId
  // fid: platform:guildId:userId
  // sid: platform:selfId

  ctx.guild().on('message-created', async (session) => {
    if (isNullable(session.userId) || session.userId === '0') return
    const member: Universal.GuildMember = { user: session.event.user, ...session.event.member }
    await ctx.cache.set(`waifu_members_${session.gid}`, session.userId, member, 4 * Time.day)
    await ctx.cache.set(`waifu_members_active_${session.gid}`, session.userId, '', cfg.activeDays * Time.day)
  })

  ctx.on('guild-member-removed', (session) => {
    if (isNullable(session.userId) || session.userId === '0') return
    ctx.cache.delete(`waifu_members_${session.gid}`, session.userId)
    ctx.cache.delete(`waifu_members_active_${session.gid}`, session.userId)
  })

  async function getMemberList(session: Session, gid: string) {
    let result: Universal.GuildMember[] = []
    try {
      const { data, next } = await session.bot.getGuildMemberList(session.guildId)
      result = data
      if (next) {
        const { data } = await session.bot.getGuildMemberList(session.guildId, next)
        result.push(...data)
      }
    } catch {
    }
    if (!result.length) {
      for await (const value of ctx.cache.values(`waifu_members_${gid}`)) {
        result.push(value)
      }
    }
    return result
  }

  async function getMemberInfo(member: Universal.GuildMember, id: string, platform: string) {
    let name = member?.nick || member?.user?.nick || member?.user?.name
    const avatar = member?.avatar || member?.user?.avatar
    if (!name && ctx.database) {
      const user = await ctx.database.getUser(platform, id)
      if (user?.name) {
        name = user.name
      }
    }
    name ||= id
    return [name, avatar]
  }

  ctx.command('waifu')
    .alias('marry', '娶群友', '今日老婆')
    .action(async ({ session }) => {
      if (!session.guildId) {
        return session.text('.members-too-few')
      }
      const { gid } = session
      // 修复换老婆达到上限时可通过此指令进行重置
      const target = await ctx.cache.get(`waifu_marriages_${gid}`, session.userId)
      let times = await ctx.cache.get(`waifu_times_${gid}`, session.userId)
      if (cfg.changeWaifu) {
        if (times > cfg.maxTimes && cfg.maxTimes != 0 && target == undefined) {
          return session.text('.times-too-many', {
            quote: h.quote(session.messageId)
          })
        }
      }
      // 已有老婆
      if (target) {
        let selected: Universal.GuildMember
        try {
          selected = await session.bot.getGuildMember(session.guildId, target)
        } catch {
        }
        try {
          const member = await ctx.cache.get(`waifu_members_${gid}`, target)
          if (!selected) {
            selected = member
          } else {
            selected.nick ??= member.nick
            selected.user ??= member.user
            selected.user.name ??= member.user.name
          }
        } catch {
        }
        try {
          selected ??= { user: await session.bot.getUser(target) }
        } catch {
        }
        // 返回已有老婆
        const [name, avatar] = await getMemberInfo(selected, target, session.platform)
        return session.text('.marriages', {
          quote: h.quote(session.messageId),
          name,
          avatar: avatar && h.image(avatar)
        })
      }

      const excludes = cfg.excludeUsers.map(({ uid }) => uid)
      excludes.push(session.uid, session.sid)

      const memberList = await getMemberList(session, gid)
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

      let selected = Random.pick(list)
      let selectedId = selected.user.id
      const selectedTarget = await ctx.cache.get(`waifu_marriages_${gid}`, selectedId)
      if (selectedTarget) {
        selected = Random.pick(list)
        selectedId = selected.user.id
      }
      if (cfg.avoidNtr) {
        let i = 0
        while (true) {
          const selectedTarget = await ctx.cache.get(`waifu_marriages_${gid}`, selectedId)
          if (selectedTarget) {
            selected = Random.pick(list)
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

      // 防止未定义
      if (times == undefined) {
        times = 0
      }
      // 记录已经结婚，设置times+1，确保用户下次调用换老婆时能够获得正确的次数
      await ctx.cache.set(`waifu_times_${gid}`, session.userId, times+1, maxAge)

      const [name, avatar] = await getMemberInfo(selected, selectedId, session.platform)
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

        const targetId = target.slice(session.platform.length + 1)
        if (targetId === session.userId) return session.text('.target-self')
        const { gid } = session

        const marriage = await ctx.cache.get(`waifu_marriages_${gid}`, session.userId)
        if (marriage) {
          return session.text('.already-marriage', {
            quote: h.quote(session.messageId)
          })
        }

        const memberList = await getMemberList(session, gid)
        const selected = memberList.find(u => u.user.id == targetId)
        if (!selected) return session.text('.members-too-few')

        const selectedId = selected.user.id
        const maxAge = getMaxAge()
        await ctx.cache.set(`waifu_marriages_${gid}`, session.userId, selectedId, maxAge)
        await ctx.cache.set(`waifu_marriages_${gid}`, selectedId, session.userId, maxAge)

        const [name, avatar] = await getMemberInfo(selected, selectedId, session.platform)
        return session.text('.force-marry', {
          quote: h.quote(session.messageId),
          name,
          avatar: avatar && h.image(avatar)
        })
      })
  }

  if (cfg.propose) {
    ctx.command('propose <target:user>')
      .alias('求婚')
      .action(async ({ session }, target) => {
        if (!session.guildId) {
          return session.text('.members-too-few')
        }
        if (!target) {
          return session.text('.no-target', {
            quote: h.quote(session.messageId)
          })
        }

        const targetId = target.slice(session.platform.length + 1)
        if (targetId === session.userId) return session.text('.target-self')
        const { gid } = session

        const marriage = await ctx.cache.get(`waifu_marriages_${gid}`, session.userId)
        if (marriage) {
          return session.text('.already-marriage', {
            quote: h.quote(session.messageId)
          })
        }

        const memberList = await getMemberList(session, gid)
        const selected = memberList.find(u => u.user.id == targetId)
        if (!selected) return session.text('.members-too-few')

        const selectedId = selected.user.id
        const [name, avatar] = await getMemberInfo(selected, selectedId, session.platform)


        await session.send(
          session.text('.request', {
            targetAt: h.at(selected.user.id),
            targetAvatar: h.image(avatar),
            name: session.username,
            agree: '我愿意',
            reject: '我拒绝',
            time: '90'
          })
        )

        let timeoutId: NodeJS.Timeout
        const sourceMessageId = session.messageId
        const sourceUserId = session.userId

        const dispose = ctx.platform(session.platform)
          .user(selected.user.id)
          .guild(session.guildId)
          .on('message-created', async ({ elements, text, send }) => {
            const reply = h.select(elements, 'text').join('').trim()
            if (reply === '我愿意') {
              dispose()
              clearTimeout(timeoutId)
              const isMarriaged = await ctx.cache.get(`waifu_marriages_${gid}`, selectedId)
              if (isMarriaged) {
                await send(
                  text('commands.propose.messages.already-marriage2', {
                    quote: h.at(selectedId)
                  })
                )
                return
              }
              const maxAge = getMaxAge()
              await ctx.cache.set(`waifu_marriages_${gid}`, sourceUserId, selectedId, maxAge)
              await ctx.cache.set(`waifu_marriages_${gid}`, selectedId, sourceUserId, maxAge)
              await send(
                text('commands.propose.messages.success', {
                  quote: h.quote(sourceMessageId),
                  name
                })
              )
            } else if (reply === '我拒绝') {
              dispose()
              clearTimeout(timeoutId)
              await send(
                text('commands.propose.messages.failure', {
                  quote: h.quote(sourceMessageId)
                })
              )
            }
          })

        timeoutId = setTimeout(() => {
          dispose()
        }, 90 * Time.second)
      })
  }


  if (cfg.divorce) {
    ctx.command('divorce')
      .alias('离婚')
      .action(async ({ session }) => {
        const { gid } = session

        const marriage = await ctx.cache.get(`waifu_marriages_${gid}`, session.userId)
        if (!marriage) {
          return session.text('.not-married', {
            quote: h.quote(session.messageId)
          })
        } else {
          ctx.cache.delete(`waifu_marriages_${gid}`, marriage)
          ctx.cache.delete(`waifu_marriages_${gid}`, session.userId)
          return session.text('.divorcement', {
            quote: h.quote(session.messageId)
          })
        }
      })
  }

  if (cfg.changeWaifu) {
    ctx.command('change-waifu')
      .alias('换老婆')
      .action(async ({ session }) => {
        if (!session.guildId) {
          return session.text('.members-too-few')
        }
        const { gid } = session
        const marriage = await ctx.cache.get(`waifu_marriages_${gid}`, session.userId)
        const maxAge = getMaxAge()
        let times = await ctx.cache.get(`waifu_times_${gid}`, session.userId)
        if (times > cfg.maxTimes && cfg.maxTimes != 0) {
          if (marriage) {
            ctx.cache.delete(`waifu_marriages_${gid}`, marriage)
            ctx.cache.delete(`waifu_marriages_${gid}`, session.userId)
          }
          return session.text('.times-too-many', {
            quote: h.quote(session.messageId)
          })
        } else if (!marriage || times == 0 || typeof times == 'undefined') {
          // 修复用户为其他人老婆时无法换老婆的问题
          if(marriage != undefined){
            await ctx.cache.set(`waifu_times_${gid}`, session.userId, 1, maxAge)
            times = await ctx.cache.get(`waifu_times_${gid}`, session.userId)
          }
          else {
            return session.text('.not-married', {
              quote: h.quote(session.messageId)
            })
          }
        }
        const excludes = cfg.excludeUsers.map(({ uid }) => uid)
        excludes.push(session.uid, session.sid)
        const memberList = await getMemberList(session, gid)
        let list = memberList.filter((v) => {
          return v.user && !excludes.includes(`${session.platform}:${v.user.id}`) && !v.user.isBot
        })
        if (cfg.onlyActiveUser) {
          let activeList = []
          for await (const value of ctx.cache.keys(`waifu_members_active_${gid}`)) {
            activeList.push(value)
          }
          list = list.filter((v) => activeList.find((active) => active === v.user.id))
        }

        //如果没有人，就返回members-too-few
        if (list.length === 0) return session.text('.members-too-few')

        //随机获取一个人，并且获取他的id和marriages信息
        let selected = Random.pick(list)
        let selectedId = selected.user.id
        const selectedTarget = await ctx.cache.get(`waifu_marriages_${gid}`, selectedId)

        //获取被选中的人的信息
        if (selectedTarget) {
          selected = Random.pick(list)
          selectedId = selected.user.id
        }

        //避免 ntr
        if (cfg.avoidNtr) {
          let i = 0
          //循环判断，如果选中的人还是结婚，那么就重新获取一个
          while (true) {
            const selectedTarget2 = await ctx.cache.get(`waifu_marriages_${gid}`, selectedId)
            if (selectedTarget2) {
              selected = Random.pick(list)
              selectedId = selected.user.id
            } else {
              //跳出循环
              break
            }
            //循环次数如果超过，那么就返回人太少
            i++
            if (i > list.length) return session.text('.members-too-few')
          }
        }

        //如果程序运行到这里，那么说明已经获取了一个新的人，那么就继续

        //解绑当前关系
        ctx.cache.delete(`waifu_marriages_${gid}`, marriage)
        ctx.cache.delete(`waifu_marriages_${gid}`, session.userId)

        //绑定新的关系
        await ctx.cache.set(`waifu_marriages_${gid}`, session.userId, selectedId, maxAge)
        await ctx.cache.set(`waifu_marriages_${gid}`, selectedId, session.userId, maxAge)

        //请求次数+1
        await ctx.cache.set(`waifu_times_${gid}`, session.userId, times + 1, maxAge)

        const [name2, avatar] = await getMemberInfo(selected, selectedId, session.platform)
        if (times == cfg.maxTimes && cfg.maxTimes != 0) {
          return session.text('.last-times', {
            quote: h.quote(session.messageId),
            name: name2,
            avatar: avatar && h.image(avatar)
          })
        } else if (times < cfg.maxTimes || cfg.maxTimes == 0) {
          return session.text('.change-success', {
            quote: h.quote(session.messageId),
            name: name2,
            avatar: avatar && h.image(avatar)
          })
        } else {
          return session.text('Error')
        }


      })
  }

  if (cfg.waifuQuery) {
    ctx.command('waifu-query')
      .alias('查老婆')
      .action(async ({ session }) => {
        if (!session.guildId) {
          return session.text('.not-married')
        }
        const { gid } = session
        const target = await ctx.cache.get(`waifu_marriages_${gid}`, session.userId)
        if (target) {
          let selected: Universal.GuildMember
          try {
            selected = await session.bot.getGuildMember(session.guildId, target)
          } catch {
          }
          try {
            const member = await ctx.cache.get(`waifu_members_${gid}`, target)
            if (!selected) {
              selected = member
            } else {
              selected.nick ??= member.nick
              selected.user ??= member.user
              selected.user.name ??= member.user.name
            }
          } catch {
          }
          try {
            selected ??= { user: await session.bot.getUser(target) }
          } catch {
          }
          const [name, avatar] = await getMemberInfo(selected, target, session.platform)
          return session.text('.marriages', {
            quote: h.quote(session.messageId),
            name,
            avatar: avatar && h.image(avatar)
          })
        } else {
          return session.text('.not-married')
        }
      })
  }
}
