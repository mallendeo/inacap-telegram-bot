'use strict'

const inacap = require('./lib/inacap')
const removeDiacritics = require('diacritics').remove
const fileAsync = require('lowdb/lib/file-async')
const low = require('lowdb')
const Cryptr = require('cryptr')

if (!process.env.SECRET_KEY || !process.env.TELEGRAM_TOKEN) {
  throw Error('SECRET_KEY and TELEGRAM_TOKEN required!')
}

const cryptr = new Cryptr(process.env.SECRET_KEY)
const db = low('db.json', {
  storage: fileAsync,
  format: {
    deserialize: str => JSON.parse(cryptr.decrypt(str)),
    serialize: obj => cryptr.encrypt(JSON.stringify(obj))
  }
})

db.defaults({ users: [] }).value()

const TelegramBot = require('node-telegram-bot-api')

const token = process.env.TELEGRAM_TOKEN
const bot = new TelegramBot(token, { polling: true })

// Helpers
const atob = str => new Buffer(str).toString('base64')
const btoa = str => new Buffer(str, 'base64').toString('ascii')


const init = id => {
  const session = inacap()
  const user = db.get('users').find({ id }).value()

  if (!user) {
    bot.sendMessage(id, 'Debes loguearte primero. /login rut contraseña')
    return false
  }

  let period = null
  return {
    login: () =>
      session.login(btoa(user.rut), btoa(user.password))
        .then(() => session.getPeriods())
        .then(periods => {
          period = periods[0]
          return session.getCareers(period.peri_ccod)
        })
        .then(careers => ({
          period,
          career: careers[0]
        })
      ),
    session
  }
}

bot.onText(/\/login (.{1,}) (.{1,})/, (msg, match) => {
  const rut = match[1]
  const password = match[2]

  if (db.get('users').find({ id: msg.from.id }).value()) {
    bot.sendMessage(msg.from.id, 'Ya te encuentras logueado.')
    return
  }

  bot.sendMessage(msg.from.id, 'Ingresando a Inacap...')

  inacap().login(rut, password)
    .then(() => {
      bot.sendMessage(msg.from.id, 'Login exitoso, para salir usa /logout')

      return db.get('users')
        .push({
          id: msg.from.id,
          rut: atob(rut),
          password: atob(password)
        })
        .last()
        .value()
    })
    .catch(err => {
      console.log(err)
      bot.sendMessage(msg.from.id, 'Usuario y/o contraseña incorrectos.')
    })
})

bot.onText(/\/logout/, (msg, match) => {
  const removed = db.get('users').remove({ id: msg.from.id }).value()
  if (removed) {
    bot.sendMessage(msg.from.id, 'Sesión terminada.')
  }
})

bot.onText(/\/start/, (msg, match) =>
  bot.sendMessage(msg.from.id, 'Ingresa usando /login rut contraseña'))

bot.onText(/\/notas(?:@\w{1,})?\s?(.{1,})?/, (msg, match) => {
  const user = init(msg.from.id)
  user && user.login()
    .then(({ career, period }) =>
      user.session.getGrades(period.peri_ccod, career.carr_ccod))
    .then(({ informacion_notas: { listado_asignaturas } }) => {
      const term = match[1] ? removeDiacritics(match[1]) : null
      const list = term
        ? listado_asignaturas.filter(item => (
            removeDiacritics(item.nombre_asigntura.toLowerCase()).includes(term) ||
            removeDiacritics(item.nombre_profesor.toLowerCase()).includes(term)
          )
        )
        : listado_asignaturas

      if (!list.length && term) {
        bot.sendMessage(msg.chat.id, 'No se encontró la asignatura.')
        return
      }

      list.forEach(item => {
        const gradesList = item.listado_evaluaciones.reduce((prev, curr) => {
          const { fecha, nota, ponderacion } = curr
          if (!nota) return prev
          prev += `\t\t*${fecha}* | nota: *${nota}* | pon: *${ponderacion}* | curso: ${curr.prom_calificacion}\n`
          return prev
        }, '')

        if (!gradesList && term) {
          bot.sendMessage(msg.chat.id, 'No hay notas para esta asignatura.')
          return
        }

        if (gradesList) {
          const message = `*Asignatura*: ${item.nombre_asigntura}\n` +
            `*Profesor*: ${item.nombre_profesor}\n` +
            `*Notas*: \n${gradesList}`

          bot.sendMessage(msg.chat.id, message, { parse_mode: 'markdown' })
        }
      })
    })
})

bot.onText(/\/horario(?:@\w{1,})?\s?(\d)?/, (msg, match) => {
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
