'use strict'

const cheerio = require('cheerio')
const request = require('superagent')

const inacap = (jar = []) => {
  const urls = {
    login: 'https://adfs.inacap.cl/adfs/ls',
    notas: 'https://siga3.inacap.cl/siga/portal_nl/alumnos/mis_notas/ajax_notas_alumno.asp',
    horario: 'https://siga3.inacap.cl/Inacap.Siga.Horarios/Horario.aspx?SESI_CCOD='
  }

  const cookieJar = () => ({
    add: cookies => (jar = jar.concat(cookies)),
    getCookieJar: () => jar,
    getAll: () => jar.map(c => c.match(/(.+?)=(.+?);/)[0]).join(''),
    get: name => jar.find(c => c.startsWith(name)),
    getValue: c => (c ? c.match(/.+?=(.+?);/)[1] : null)
  })

  const cleanRut = rut => {
    // http://users.dcc.uchile.cl/~mortega/microcodigos/validarrut/javascript.html
    const dv = T => {
      let M = 0
      let S = 1
      for (; T; T = Math.floor(T / 10)) {
        S = (S + T % 10 * (9 - M++ % 6)) % 11
      }
      return S ? S - 1 : 'k'
    }
    rut = rut.match(/\d/g).join('').substring(0, 8)
    return [rut, dv(rut)].join('-')
  }

  const cookies = cookieJar()
  const sessionCode = () => cookies.getValue(cookies.get('ID_SESION_H')) || null

  const postForm = (url, data = {}, jar, prevRes) =>
    new Promise((resolve, reject) => {
      const req = request.post(url)
        .type('form')
        .redirects(0)
        .send(data)
        .set({ 'cookie': jar.getAll() })

      if (prevRes) req.set({ 'Referer': prevRes.request.url })

      req.end((err, res) => {
        if (err && res.statusCode !== 302) reject(err)

        let cookies = res.header['set-cookie']
        if (cookies) jar.add(cookies)

        resolve(res)
      })
    })

  const fillForm = (html, jar, prevRes) => {
    const $ = cheerio.load(html)
    const postUrl = $('form').attr('action')
    const data = {}
    $('input[type=hidden]').each((i, elem) => {
      data[elem.attribs.name] = elem.attribs.value
    })

    return postForm(postUrl, data, jar, prevRes)
  }

  const getPage = (url, jar, prevRes) =>
    new Promise((resolve, reject) => {
      const req = request.get(url)
        .set({ 'cookie': jar.getAll() })
        .redirects(0)

      if (prevRes) req.set({ 'Referer': prevRes.request.url })

      req.end((err, res) => {
        if (err && res.statusCode !== 302) return reject(err)
        const cookies = res.header['set-cookie']
        if (cookies) jar.add(cookies)

        resolve(res)
      })
    })

  const login = (username, password) => {
    jar = [] // reset cookie jar
    const qs = [
      'wtrealm=https://siga.inacap.cl/sts/',
      'wa=wsignin1.0',
      'wreply=https://siga.inacap.cl/sts/',
      'wctx=https%3a%2f%2fadfs.inacap.cl%2fadfs%' +
      '2fls%2f%3fwreply%3dhttps%3a%2f%2f' +
      'www.inacap.cl%2ftportalvp%2fintranet-alumno' +
      '%26wtrealm%3dhttps%3a%2f%2fwww.inacap.cl%2f'
    ].join('&')

    const url = urls['login'] + '?' + qs

    const data = {
      UserName: 'inacap\\' + cleanRut(username),
      Password: password,
      AuthMethod: 'FormsAuthentication'
    }

    return postForm(url, data, cookies)
      .then(res => getPage(res.header.location, cookies, res))
      .then(res => fillForm(res.text, cookies, res))
      .then(res => getPage(res.header.location, cookies, res))
      .then(res => fillForm(res.text, cookies, res))
      .then(res => {
        if (res) {
          return {
            cookies: cookies.getCookieJar(),
            sessionCode: sessionCode()
          }
        }
      })
  }

  const getFromGradesUrl = form =>
    postForm(urls['notas'], form, cookies)
      .then(res => JSON.parse(res.text))

  const getPeriods = () =>
    getFromGradesUrl({
      funcion: 'obtenerPeriodosALumno',
      sesi_ccod: sessionCode()
    })

  const getCareers = period =>
    getFromGradesUrl({
      funcion: 'obtenerCarrerasAlumno',
      peri_ccod: period,
      sesi_ccod: sessionCode()
    })

  const getSchedule = period =>
    postForm(urls['horario'] + sessionCode(), {
      periodo: period,
      tipo_usuario: 1
    }, cookies).then(res => {
      const schedule = res.text.match(/\},events:(.*?),eventRender:/)
      if (schedule && schedule[1]) {
        return JSON.parse(schedule[1])
      }
    })

  const getGrades = (period, career) => {
    if (!period || !career) throw Error('period and career required!')
    return getFromGradesUrl({
      funcion: 'obtenerNotasAlumno',
      peri_ccod: period,
      carr_ccod: career,
      sesi_ccod: sessionCode()
    })
  }

  return {
    getPeriods,
    getCareers,
    getSchedule,
    getGrades,
    login
  }
}

module.exports = inacap
