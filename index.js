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
const db = low('data/db.json', {
  storage: fileAsync,
  format: {
    deserialize: str => JSON.parse(cryptr.decrypt(str)),
    serialize: obj => cryptr.encrypt(JSON.stringify(obj))
  }
})

db.defaults({ users: [] }).value()

const TelegramBot = require('node-telegram-bot-api')

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true })

// Helpers
const atob = str => new Buffer(str).toString('base64')
const btoa = str => new Buffer(str, 'base64').toString('ascii')
const minutes = (n = 15) => Date.now() + n * 60 * 1000

const init = id => {
  const user = db.get('users').find({ id }).value()

  if (!user) {
    bot.sendMessage(id, 'Debes loguearte primero. /login rut contraseña')
    return false
  }

  if (
    (user.expires < Date.now()) ||
    !user.period ||
    !user.career
  ) {
    const session = inacap()
    let period = null
    bot.sendMessage(id, 'Re-logueando Inacap')

    return {
      login: () => session
        .login(btoa(user.rut), btoa(user.password))
        .then(({ cookies }) => {
          user.cookies = cookies
          user.expires = minutes()
          return session.getPeriods()
        })
        .then(periods => {
          period = periods[0]
          user.period = period
          return session.getCareers(period.peri_ccod)
        })
        .then(careers => {
          const career = careers[0]
          user.career = career

          return {
            period,
            career
          }
        }),
      session
    }
  }

  const session = inacap(user.cookies)
  const { period, career } = user
  return {
    login: () => Promise.resolve({ period, career }),
    session
  }
}

bot.onText(/login (.{1,}) (.{1,})/, (msg, match) => {
  const rut = match[1]
  const password = match[2]

  if (db.get('users').find({ id: msg.from.id }).value()) {
    bot.sendMessage(msg.from.id, 'Ya te encuentras logueado.')
    return
  }

  bot.sendMessage(msg.from.id, 'Ingresando a Inacap...')

  inacap().login(rut, password)
    .then(({ cookies }) => {
      bot.sendMessage(msg.from.id, 'Login exitoso, para salir usa /logout')

      return db.get('users')
        .push({
          id: msg.from.id,
          rut: atob(rut),
          password: atob(password),
          cookies,
          expires: minutes()
        })
        .last()
        .value()
    })
    .catch(err => {
      console.log(err)
      bot.sendMessage(msg.from.id, 'Usuario y/o contraseña incorrectos.')
    })
})

bot.onText(/logout/, (msg, match) => {
  const removed = db.get('users').remove({ id: msg.from.id }).value()
  if (removed) {
    bot.sendMessage(msg.from.id, 'Sesión terminada.')
  }
})

bot.onText(/start/, (msg, match) =>
  bot.sendMessage(msg.from.id, 'Ingresa usando /login rut contraseña'))

bot.onText(/doot/, msg => bot.sendMessage(msg.chat.id, '🎺🎺💀'))

bot.onText(/notas(?:@\w{1,})?\s?(.{1,})?/, (msg, match) => {
  const user = init(msg.from.id)
  user && user.login()
    .then(({ career, period }) =>
      user.session.getGrades(period.peri_ccod, career.carr_ccod))
    .then(({ informacion_notas: { listado_asignaturas } }) => {
      const term = match[1] ? deburr(match[1]) : null
      const list = term
        ? listado_asignaturas.filter(item => (
            deburr(item.nombre_asigntura.toLowerCase()).includes(term) ||
            deburr(item.nombre_profesor.toLowerCase()).includes(term)
          )
        )
        : listado_asignaturas

      if (!list.length && term) {
        bot.sendMessage(msg.chat.id, 'No se encontró la asignatura.')
        return
      }

      const cookies = user.session.cookies
      const nombre = cookies.getValue(cookies.get('NOMBRE_COMPLETO_H'))
      let message = `*${words(nombre).join(' ')}*\n\n`

      list.forEach(item => {
        const gradesList = item.listado_evaluaciones.reduce((prev, curr) => {
          const { fecha, nota, ponderacion, prom_calificacion } = curr
          if (!nota) return prev
          prev += `\t\t*${fecha}* | nota: *${nota}* | pon: *${ponderacion}* | curso: ${prom_calificacion}\n`
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

bot.onText(/horario(?:@\w{1,})?\s?(\d)?/, (msg, match) => {
  const user = init(msg.from.id)
  user && user.login()
    .then(({ period }) => user.session.getSchedule(period.peri_ccod))
    .then((data) => {
      let schedule = data.filter(item => {
        const now = new Date()
        const classDate = new Date(item.start)
        return classDate.getMonth() === now.getMonth() &&
          classDate.getDate() === now.getDate()
      })

      if (match[1]) {
        schedule = data.filter(item => {
          const now = new Date()
          const classDate = new Date(item.start)
          return classDate.getMonth() === now.getMonth() &&
            classDate.getDay() === parseInt(match[1])
        })
      }

      let message = schedule.reduce((prev, curr) => {
        if (!curr.data.asignatura) return prev
        if (match[1]) {
          prev += `*Fecha: ${curr.data.fecha}*\n`
        }
        prev += `*Asignatura*: ${curr.data.asignatura}\n`
        prev += `*Sala*: ${curr.data.sala}\n`
        prev += `*Inicio*: ${curr.data.hora_inicio}\n`
        prev += `*Término*: ${curr.data.hora_termino}\n`
        prev += `*Profesor*: ${curr.data.profesor}\n\n`
        return prev
      }, '')

      if (!message) message = 'No hay clases asignadas para hoy.'
      bot.sendMessage(msg.chat.id, message, { parse_mode: 'markdown' })
    })
})

console.log('Starting bot...')
