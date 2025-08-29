require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express()

// const allow = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
app.use((req, res, next) => {
    const o = req.headers.origin
    if (!allow.length || (o && allow.includes(o))) res.setHeader('Access-Control-Allow-Origin', o || '*')
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    if (req.method === 'OPTIONS') return res.status(204).end()
    next()
})

const allow = [
    'http://localhost:3005',
    'http://127.0.0.1:3005',
    'https://clinic-app-lilac.vercel.app', // сюда добавь прод-URL фронта
];

app.use(cors({
    origin: (origin, cb) => {
        if (!origin || allow.includes(origin)) {
            cb(null, true);
        } else {
            cb(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));
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
        const q = `SELECT user_id, full_name, phone, birth_date, client_code, ref_code, bonus_balance, role, reg_date, avatar_url  FROM public.client WHERE user_id=$1`
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
            `INSERT INTO public.client (user_id, full_name, birth_date, phone, reg_date, client_code, role)
       VALUES ($1,$2,$3,$4,NOW(),$5,'client')
       ON CONFLICT (user_id) DO NOTHING`,
            [user_id, full_name, birth_date, phone, clientCode]
        )
        const r = await pool.query(
            `SELECT user_id, full_name, phone, birth_date, client_code, bonus_balance, role, reg_date, avatar_url FROM public.client WHERE user_id=$1`,
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
            `UPDATE public.client SET full_name=$1, birth_date=$2, phone=$3 WHERE user_id=$4`,
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
        const hasId = await pool.query(`
      select 1
      from information_schema.columns
      where table_schema = 'public' and table_name = 'specialties' and column_name = 'id'
      limit 1
    `)

        const q = hasId.rowCount
            ? 'select id, name from public.specialties order by id'
            : 'select name from public.specialties'

        const result = await pool.query(q)
        res.json(result.rows)
    } catch (e) {
        console.error('Ошибка /specialties:', e)
        res.status(500).json({ error: 'Ошибка при получении специальностей', details: String(e.message) })
    }
})

app.get('/api/doctor-services', async (req, res) => {
    try {
        const cols = await pool.query(`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'doctor_services'
    `)

        const colNames = cols.rows.map(r => r.column_name)
        let q = 'select * from public.doctor_services'

        if (colNames.includes('doctor_id') && colNames.includes('service_id')) {
            q = 'select doctor_id, service_id from public.doctor_services order by doctor_id, service_id'
        }

        const result = await pool.query(q)
        res.json(result.rows)
    } catch (e) {
        console.error('Ошибка /doctor-services:', e)
        res.status(500).json({ error: 'Ошибка при получении связей врач-услуга', details: String(e.message) })
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
    const { doctor_id, month, date_from, date_to } = req.query || {};
    if (!doctor_id) return res.status(400).json({ error: 'doctor_id required' });

    let from = date_from, to = date_to;
    if (month) {
        const [Y, M] = String(month).split('-').map(Number);
        const d0 = new Date(Y, M - 1, 1);
        const d1 = new Date(Y, M, 1);
        const pad2 = n => String(n).padStart(2, '0');
        from = from || `${d0.getFullYear()}-${pad2(d0.getMonth() + 1)}-01`;
        to = to || `${d1.getFullYear()}-${pad2(d1.getMonth() + 1)}-01`;
    }
    if (!from || !to) return res.status(400).json({ error: 'period required (month or date_from/date_to)' });

    try {
        const identsQ = await pool.query(
            `SELECT DISTINCT ident_staff_id::text AS ident
         FROM public.doctor_schedule
        WHERE doctor_id::text = $1`,
            [String(doctor_id)]
        );
        const identIds = identsQ.rows.map(r => r.ident);
        if (!identIds.length) return res.json({ doctor_id, month, days: {} });

        const schedQ = await pool.query(
            `SELECT to_char(date::date,'YYYY-MM-DD') AS iso, time, is_available
         FROM public.doctor_schedule
        WHERE ident_staff_id::text = ANY($1::text[])
          AND date >= $2::date AND date < $3::date
          AND is_available = true
        ORDER BY date ASC, time ASC`,
            [identIds, from, to]
        );

        const busyAptQ = await pool.query(
            `SELECT to_char(date::date,'YYYY-MM-DD') AS iso, time AS t
         FROM public.appointments
        WHERE doctor_id = $1
          AND date >= $2::date AND date < $3::date
          AND COALESCE(status,'active') NOT IN ('cancelled','rejected')`,
            [doctor_id, from, to]
        );

        const busyQ = await pool.query(
            `SELECT to_char(planstart,'YYYY-MM-DD') AS iso,
              planstart, planend
         FROM public.ident_receptions
        WHERE id_staffs::text = ANY($1::text[])
          AND planstart >= $2::timestamp
          AND planstart <  $3::timestamp`,
            [identIds, from, to]
        );

        const mins = (h, m) => h * 60 + m;
        const minsFromHMS = (s) => {
            if (!s) return 0;
            const [hh, mm] = String(s).split(':').map(Number);
            return mins(hh || 0, mm || 0);
        };
        const timeFromMins = (m) =>
            `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

        const availabilityDay = new Map();

        for (const row of schedQ.rows) {
            const [l, r] = String(row.time).split('-').map(s => s.trim());
            const start = minsFromHMS(l), end = minsFromHMS(r);
            if (end <= start) continue;
            if (!availabilityDay.has(row.iso)) availabilityDay.set(row.iso, new Set());
            const s = availabilityDay.get(row.iso);
            for (let m = start; m < end; m += 15) s.add(Math.floor(m / 15));
        }

        for (const row of busyQ.rows) {
            const s = availabilityDay.get(row.iso);
            if (!s) continue;
            const st = row.planstart;
            const en = row.planend;
            const startMin = st.getHours() * 60 + st.getMinutes();
            const endMin = en.getHours() * 60 + en.getMinutes();
            for (let m = startMin; m < endMin; m += 15) s.delete(Math.floor(m / 15));
        }

        for (const row of busyAptQ.rows) {
            const s = availabilityDay.get(row.iso);
            if (!s) continue;
            const [hh, mm] = String(row.t).split(':').map(Number);
            const startMin = (hh || 0) * 60 + (mm || 0);
            for (let m = startMin; m < startMin + 30; m += 15) s.delete(Math.floor(m / 15));
        }

        const daysOut = {};
        for (const [iso, setQ] of availabilityDay.entries()) {
            const slots = [];
            for (let q = 0; q <= 94; q += 2) {
                if (setQ.has(q) && setQ.has(q + 1)) slots.push(timeFromMins(q * 15));
            }
            if (slots.length) daysOut[iso] = slots;
        }

        res.json({ doctor_id, month: month || undefined, date_from: from, date_to: to, days: daysOut });
    } catch (e) {
        console.error('availability error:', e);
        res.status(500).json({ error: 'SERVER_ERROR', details: e.message });
    }
});

app.post('/api/appointments', async (req, res) => {
    const client = await pool.connect();
    try {
        const {
            user_id,
            clinic_id = null,
            doctor_id,
            doctor_name,
            services = [],        // [{ id, name, price }]
            date,                 // 'YYYY-MM-DD'
            time,                 // 'HH:mm'
            status = 'active',    // делаем активным по умолчанию
        } = req.body || {};

        if (!user_id || !doctor_id || !date || !time || !Array.isArray(services) || !services.length) {
            return res.status(400).json({ error: 'REQUIRED_FIELDS', details: 'user_id, doctor_id, date, time, services[]' });
        }

        await client.query('BEGIN');

        // 1) защитимся от двойного бронирования
        const clash = await client.query(
            `SELECT 1
         FROM public.appointments
        WHERE doctor_id = $1
          AND date = $2::date
          AND time = $3::time
          AND COALESCE(status,'active') NOT IN ('cancelled','rejected')
        LIMIT 1`,
            [doctor_id, date, time]
        );
        if (clash.rowCount) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'SLOT_TAKEN' });
        }

        // 2) вставляем по каждой услуге
        const inserted = [];
        for (const s of services) {
            const r = await client.query(
                `INSERT INTO public.appointments
           (user_id, clinic_id, service_id, date, time, status, created_at,
            doctor_name, service_name, service_price, doctor_id)
         VALUES ($1,$2,$3,$4,$5,$6, NOW(),
                 $7,$8,$9,$10)
         RETURNING *`,
                [
                    user_id,
                    clinic_id,
                    s?.id ?? null,
                    date,
                    time,              // БД сама приведёт 'HH:mm' -> time
                    status,
                    doctor_name ?? null,
                    s?.name ?? null,
                    s?.price ?? null,
                    doctor_id,
                ]
            );
            inserted.push(r.rows[0]);
        }

        await client.query('COMMIT');
        res.json({ ok: true, inserted });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => { });
        console.error('Ошибка /appointments:', e);
        res.status(500).json({ error: 'SERVER_ERROR', details: e.message });
    } finally {
        client.release();
    }
});

app.get('/api/appointments/:user_id', async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT *
         FROM public.appointments
        WHERE user_id = $1
        ORDER BY date ASC, time ASC, id ASC`,
            [req.params.user_id]
        );
        res.json(r.rows);
    } catch (e) {
        res.status(500).json({ error: 'SERVER_ERROR', details: e.message });
    }
});

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `avatar_${req.params.user_id}${ext}`);
    }
});
const upload = multer({ storage });

app.post('/api/user/:user_id/avatar', async (req, res) => {
    const { user_id } = req.params;
    const { avatar_url } = req.body;

    if (!avatar_url) {
        return res.status(400).json({ error: 'NO_URL' });
    }

    try {
        await pool.query(
            `UPDATE public.client SET avatar_url=$1 WHERE user_id=$2`,
            [avatar_url, user_id]
        );
        res.json({ success: true, avatar_url });
    } catch (e) {
        res.status(500).json({ error: 'SERVER_ERROR', details: e.message });
    }
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


module.exports = app
