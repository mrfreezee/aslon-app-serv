require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')

const app = express()

const allow = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
app.use((req, res, next) => {
    const o = req.headers.origin
    if (!allow.length || (o && allow.includes(o))) res.setHeader('Access-Control-Allow-Origin', o || '*')
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    if (req.method === 'OPTIONS') return res.status(204).end()
    next()
})

app.use(cors())
app.use(express.json())

const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
    : new Pool({
        host: process.env.PGHOST || 'localhost',
        port: process.env.PGPORT ? Number(process.env.PGPORT) : 5433,
        database: process.env.PGDATABASE || 'clinic2',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'password',
    })

function pad2(n) { return String(n).padStart(2, '0') }
function mins(h, m) { return h * 60 + m }
function minsFromHMS(str) {
    if (!str) return 0
    const [hh, mm] = str.split(':').map(Number)
    return mins(hh || 0, mm || 0)
}
function timeFromMins(minsTotal) {
    const hh = Math.floor(minsTotal / 60)
    const mm = minsTotal % 60
    return `${pad2(hh)}:${pad2(mm)}`
}
function parseTimeRange(rangeStr) {
    if (!rangeStr) return [0, 0]
    const [l, r] = rangeStr.split('-').map(s => s.trim())
    return [minsFromHMS(l), minsFromHMS(r)]
}

app.get('/api/debug/db', async (req, res) => {
    try {
        const ping = await pool.query('select 1 as ok')
        const exists = await pool.query(`select to_regclass('public.services') as services`)
        res.json({ ok: true, ping: ping.rows[0], services_table: exists.rows[0].services })
    } catch (e) {
        res.status(500).json({ ok: false, error: String(e.message) })
    }
})

app.get('/api/debug/columns/services', async (req, res) => {
    try {
        const cols = await pool.query(`
      select column_name, data_type
      from information_schema.columns
      where table_schema='public' and table_name='services'
      order by ordinal_position
    `)
        res.json(cols.rows)
    } catch (e) {
        res.status(500).json({ error: String(e.message) })
    }
})

app.get('/api/health', (_, res) => res.send('ok'))

app.get('/api/user/:user_id', async (req, res) => {
    const { user_id } = req.params
    try {
        const q = `SELECT user_id, full_name, phone, birth_date, client_code, ref_code, bonus_balance, role, reg_date FROM client WHERE user_id=$1`
        const r = await pool.query(q, [user_id])
        if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' })
        res.json(r.rows[0])
    } catch (e) {
        res.status(500).json({ error: 'SERVER_ERROR', details: e.message })
    }
})

app.post('/api/user', async (req, res) => {
    const { user_id, full_name = 'Новый пользователь', birth_date = '', phone = '' } = req.body || {}
    if (!user_id) return res.status(400).json({ error: 'user_id required' })
    try {
        const clientCode = `${Math.floor(100 + Math.random() * 900)}-${Math.floor(100 + Math.random() * 900)}`
        await pool.query(
            `INSERT INTO client (user_id, full_name, birth_date, phone, reg_date, client_code, role)
       VALUES ($1,$2,$3,$4,NOW(),$5,'client')
       ON CONFLICT (user_id) DO NOTHING`,
            [user_id, full_name, birth_date, phone, clientCode]
        )
        const r = await pool.query(
            `SELECT user_id, full_name, phone, birth_date, client_code, bonus_balance, role, reg_date FROM client WHERE user_id=$1`,
            [user_id]
        )
        res.json(r.rows[0])
    } catch (e) {
        res.status(500).json({ error: 'SERVER_ERROR', details: e.message })
    }
})

app.put('/api/user/:user_id', async (req, res) => {
    const { user_id } = req.params
    const { full_name, birth_date, phone } = req.body || {}
    try {
        await pool.query(
            `UPDATE client SET full_name=$1, birth_date=$2, phone=$3 WHERE user_id=$4`,
            [full_name, birth_date, phone, user_id]
        )
        res.json({ success: true })
    } catch (e) {
        res.status(500).json({ error: 'SERVER_ERROR', details: e.message })
    }
})

app.get('/api/doctors', async (req, res) => {
    try {
        const hasId = await pool.query(`
      select 1
      from information_schema.columns
      where table_schema = 'public' and table_name = 'doctors' and column_name = 'id'
      limit 1
    `)

        const q = hasId.rowCount
            ? 'select id, name, specialty_id, tg_file_id, ident_staff_id, tg_file_id2 from public.doctors order by id'
            : 'select name, specialty_id, tg_file_id, ident_staff_id, tg_file_id2 from public.doctors'

        const result = await pool.query(q)
        res.json(result.rows)
    } catch (e) {
        console.error('Ошибка /doctors:', e)
        res.status(500).json({ error: 'Ошибка при получении врачей', details: String(e.message) })
    }
})

app.get('/api/specialties', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM specialties ORDER BY id ASC')
        res.json(result.rows)
    } catch (e) {
        res.status(500).json({ error: 'Ошибка при получении специальностей' })
    }
})

app.get('/api/doctor-services', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM doctor_services ORDER BY doctor_id ASC, service_id ASC')
        res.json(result.rows)
    } catch (e) {
        res.status(500).json({ error: 'Ошибка при получении связей врач-услуга' })
    }
})

app.get('/api/services', async (req, res) => {
    try {
        const hasId = await pool.query(`
      select 1
      from information_schema.columns
      where table_schema = 'public' and table_name = 'services' and column_name = 'id'
      limit 1
    `)
        const q = hasId.rowCount
            ? 'select id, name, price, duration, clinic_id, category, section, specialty_id from public.services order by id'
            : 'select id, name, price, duration, clinic_id, category, section, specialty_id from public.services'
        const result = await pool.query(q)
        res.json(result.rows)
    } catch (e) {
        console.error('Ошибка /services:', e)
        res.status(500).json({ error: 'Ошибка при получении услуг', details: String(e.message) })
    }
})

app.get('/api/availability', async (req, res) => {
    const { doctor_id, month, date_from, date_to } = req.query || {}
    if (!doctor_id) return res.status(400).json({ error: 'doctor_id required' })
    let from = date_from
    let to = date_to
    if (month) {
        const [Y, M] = month.split('-').map(Number)
        const d0 = new Date(Y, (M - 1), 1)
        const d1 = new Date(Y, (M - 1) + 1, 1)
        from = from || `${d0.getFullYear()}-${pad2(d0.getMonth() + 1)}-01`
        to = to || `${d1.getFullYear()}-${pad2(d1.getMonth() + 1)}-01`
    }
    if (!from || !to) return res.status(400).json({ error: 'period required (month or date_from/date_to)' })
    try {
        const identsQ = await pool.query(
            `SELECT DISTINCT ident_staff_id::text AS ident FROM public.doctor_schedule WHERE doctor_id::text = $1`,
            [doctor_id]
        )
        const identIds = identsQ.rows.map(r => r.ident)
        if (!identIds.length) return res.json({ doctor_id, month, days: {} })
        const schedQ = await pool.query(
            `SELECT date::date AS d, time, is_available
         FROM public.doctor_schedule
        WHERE ident_staff_id::text = ANY($1::text[])
          AND date >= $2::date AND date < $3::date
          AND is_available = true
        ORDER BY date ASC, time ASC`,
            [identIds, from, to]
        )
        const busyQ = await pool.query(
            `SELECT id_patients, id_staffs::text AS ident, planstart, planend
         FROM public.ident_receptions
        WHERE id_staffs::text = ANY($1::text[])
          AND planstart::timestamp >= $2::timestamp
          AND planstart::timestamp <  $3::timestamp`,
            [identIds, from, to]
        )
        const availabilityDay = new Map()
        for (const row of schedQ.rows) {
            const iso = row.d.toISOString().slice(0, 10)
            const [startMin, endMin] = parseTimeRange(row.time)
            if (endMin <= startMin) continue
            if (!availabilityDay.has(iso)) availabilityDay.set(iso, new Set())
            const s = availabilityDay.get(iso)
            for (let m = startMin; m < endMin; m += 15) {
                const q = Math.floor(m / 15)
                if (q >= 0 && q < 96) s.add(q)
            }
        }
        for (const row of busyQ.rows) {
            const start = new Date(row.planstart)
            const end = new Date(row.planend)
            const iso = start.toISOString().slice(0, 10)
            if (!availabilityDay.has(iso)) continue
            const s = availabilityDay.get(iso)
            const startMin = start.getHours() * 60 + start.getMinutes()
            const endMin = end.getHours() * 60 + end.getMinutes()
            for (let m = startMin; m < endMin; m += 15) {
                const q = Math.floor(m / 15)
                s.delete(q)
            }
        }
        const daysOut = {}
        for (const [iso, setQ] of availabilityDay.entries()) {
            const slots = []
            for (let i = 0; i <= 94; i += 2) {
                if (setQ.has(i) && setQ.has(i + 1)) slots.push(timeFromMins(i * 15))
            }
            if (slots.length) daysOut[iso] = slots
        }
        res.json({ doctor_id, month: month || undefined, date_from: from, date_to: to, days: daysOut })
    } catch (e) {
        res.status(500).json({ error: 'SERVER_ERROR', details: e.message })
    }
})

module.exports = app
