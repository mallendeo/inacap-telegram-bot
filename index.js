'use strict'

const inacap = require('./lib/inacap')
const { deburr, capitalize, words } = require('lodash')
const fileAsync = require('lowdb/lib/file-async')
const low = require('lowdb')
const Cryptr = require('cryptr')

if (!process.env.SECRET_KEY || !process.env.TELEGRAM_TOKEN) {
  throw Error('SECRET_KEY and TELEGRAM_TOKEN required!')
}

const cryptr = new Cryptr(process.env.SECRET_KEY)
const db = low(`${__dirname}/data/db.json`, {
  storage: fileAsync,
  format: {
    deserialize: str => JSON.parse(cryptr.decrypt(str)),
    serialize: obj => cryptr.encrypt(JSON.stringify(obj))
  }
})

db.defaults({ users: [] }).value()

const TelegramBot = require('node-telegram-bot-api')
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true })

const intervals = {}

// Helpers
const atob = str => new Buffer(str).toString('base64')
const btoa = str => new Buffer(str, 'base64').toString('ascii')
const minutes = (n = 20) => n * 60 * 1000

const findUser = id => db.get('users').find({ id }).value()

const login = user => {
  const session = inacap()
  return session
    .login(btoa(user.rut), btoa(user.password))
    .then(({ cookies }) => {
      user.cookies = cookies
      return session.getPeriods()
    })
    .then(periods => {
      user.period = periods[0]
      return session.getCareers(user.period.peri_ccod)
    })
    .then(careers => {
      user.career = careers[0]
    })
}

const autoLogin = user => setInterval(() => login(user), minutes())

const init = id => {
  const user = findUser(id)

  if (!user) {
    bot.sendMessage(id, 'Debes loguearte primero. /login rut contraseña')
    return false
  }

  return {
    user,
    session: inacap(user.cookies)
  }
}

bot.onText(/^\/?login ([\w-]{1,}) (.{1,})/, (msg, match) => {
  const rut = match[1]
  const password = match[2]
  const user = findUser(msg.from.id)

  if (user) {
    bot.sendMessage(msg.from.id, 'Ya te encuentras logueado.')
    return
  }

  bot.sendMessage(msg.from.id, 'Ingresando a Inacap...')
  inacap()
    .login(rut, password)
    .then(({ cookies }) => {
      const user = db
        .get('users')
        .push({
          id: msg.from.id,
          rut: atob(rut),
          password: atob(password),
          cookies
        })
        .last()
        .value()

      intervals[msg.from.id] = autoLogin(user)
      return login(findUser(msg.from.id))
    })
    .then(() => {
      bot.sendMessage(msg.from.id, 'Login exitoso, para salir usa /logout')
    })
    .catch(err => {
      console.error(err)
      bot.sendMessage(msg.from.id, 'Usuario y/o contraseña incorrectos.')
    })
})

bot.onText(/\/?logout/, (msg, match) => {
  const removed = db.get('users').remove({ id: msg.from.id }).value()
  if (removed) {
    clearInterval(intervals[msg.from.id])
    delete intervals[msg.from.id]
    bot.sendMessage(msg.from.id, 'Sesión terminada.')
  }
})

bot.onText(/\/?start/, (msg, match) =>
  bot.sendMessage(msg.from.id, 'Ingresa usando /login rut contraseña'))

// 3spooky5me
bot.onText(/\/?doot/, msg => bot.sendMessage(msg.chat.id, '🎺🎺💀'))

// Grades
bot.onText(/^\/?n(?:\w{1,})?\s?(.{1,})?$/, (msg, match) => {
  const { user, session } = init(msg.from.id)
  session && session.getGrades(user.period.peri_ccod, user.career.carr_ccod)
    .then(data => {
      const term = match[1] ? deburr(match[1]) : null
      const list = term
        ? data.informacion_notas.listado_asignaturas.filter(item => (
            deburr(item.nombre_asigntura.toLowerCase()).includes(term) ||
            deburr(item.nombre_profesor.toLowerCase()).includes(term)
          )
        )
        : data.informacion_notas.listado_asignaturas

      if (!list.length && term) {
        bot.sendMessage(msg.chat.id, 'No se encontró la asignatura.')
        return
      }

      const { cookies } = session
      const nombre = cookies.getValue(cookies.get('NOMBRE_COMPLETO_H'))
      let message = `*${words(nombre).join(' ')}*\n\n`

      list.forEach(item => {
        const gradesList = item.listado_evaluaciones.reduce((prev, curr) => {
          if (!curr.nota) return prev
          prev += `\t\t*${curr.fecha}* | `
          prev += `nota: *${curr.nota}* | `
          prev += `pon: *${curr.ponderacion}* | `
          prev += `curso: ${curr.prom_calificacion}\n`
          return prev
        }, '')

        if (!gradesList && term) {
          bot.sendMessage(msg.chat.id, 'No hay notas para esta asignatura.')
          return
        }

        if (gradesList) {
          message += `*${capitalize(item.nombre_asigntura)}*\n` +
            `*Profesor*: ${item.nombre_profesor}\n` +
            `*Notas*: \n${gradesList}\n`
        }
      })

      bot.sendMessage(msg.chat.id, message, { parse_mode: 'markdown' })
    })
})

// Schedule
bot.onText(/^\/?h(?:\w{1,})?\s?(\w{1,})?$/, (msg, match) => {
  const { user, session } = init(msg.from.id)
  session && session.getSchedule(user.period.peri_ccod).then(data => {
    let schedule = data.filter(item => {
      const now = new Date()
      const classDate = new Date(item.start)
      return classDate.getMonth() === now.getMonth() &&
        classDate.getDate() === now.getDate()
    })

    if (match[1]) {
      schedule = data.filter(item => {
        const days = ['l', 'ma', 'mi', 'j', 'v', 's']
        const dayIndex = days.findIndex(e => match[1].startsWith(e)) + 1
        const classDate = new Date(item.start)
        return classDate.getMonth() === new Date().getMonth() &&
          classDate.getDay() === dayIndex || parseInt(match[1])
      })
    }

    let message = schedule.reduce((prev, { data }) => {
      if (!data.asignatura) return prev
      if (match[1]) prev += `*Fecha: ${data.fecha}*\n`
      prev += `*Asignatura*: ${data.asignatura}\n`
      prev += `*Sala*: ${data.sala}\n`
      prev += `*Inicio*: ${data.hora_inicio}\n`
      prev += `*Término*: ${data.hora_termino}\n`
      prev += `*Profesor*: ${data.profesor}\n\n`
      return prev
    }, '')

    if (!message) message = `No hay clases asignadas${!match[1] ? ' para hoy' : ''}.`
    bot.sendMessage(msg.chat.id, message, { parse_mode: 'markdown' })
  })
})

// Attendance
bot.onText(/^\/?a(?:\w{1,})?\s?(\w{1,})?$/, (msg, match) => {
  const { user, session } = init(msg.from.id)
  session && session.getAttendance(user.period.peri_ccod).then(data => {
    const items = match[1] ? data.filter(item => item[3].includes(match[1])) : data

    const message = items.reduce((prev, curr) => {
      prev += `*${curr[3]}*\n`
      prev += `${curr[6]}% de ${curr[7]}%\n\n`
      return prev
    }, '')

    bot.sendMessage(msg.chat.id, message, { parse_mode: 'markdown' })
  })
})

console.log('Starting bot...')
db.get('users').value().forEach(user => {
  console.log('autoLogin', user.id)
  autoLogin(user)
})
