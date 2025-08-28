// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = require('./app')
  const port = process.env.PORT || 3001;

app.use(cors({
  origin: ['http://localhost:3005', 'http://127.0.0.1:3005'],
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
}));
app.use(express.json()); 

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5433,
  database: process.env.PGDATABASE || 'clinic2',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'password',
});

function pad2(n) { return String(n).padStart(2, '0'); }
function mins(h, m) { return h * 60 + m; }
function minsFromHMS(str) {
  if (!str) return 0;
  const [hh, mm] = str.split(':').map(Number);
  return mins(hh || 0, mm || 0);
}
function timeFromMins(minsTotal) {
  const hh = Math.floor(minsTotal / 60);
  const mm = minsTotal % 60;
  return `${pad2(hh)}:${pad2(mm)}`;
}


function parseTimeRange(rangeStr) {
  if (!rangeStr) return [0, 0];
  const [l, r] = rangeStr.split('-').map(s => s.trim());
  return [minsFromHMS(l), minsFromHMS(r)];
}


app.get('/health', (_, res) => res.send('ok'));


app.get('/api/user/:user_id', async (req, res) => {
  const { user_id } = req.params;
  console.log(`Получение пользователя с user_id=${user_id}`);
  try {
    const q =
      `SELECT user_id, full_name, phone, birth_date, client_code, ref_code, bonus_balance, role, reg_date
       FROM client WHERE user_id=$1`;
    const r = await pool.query(q, [user_id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    console.log(`Пользователь найден: ${JSON.stringify(r.rows[0])}`);
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'SERVER_ERROR', details: e.message });
  }
});

app.post('/api/user', async (req, res) => {
  const { user_id, full_name = 'Новый пользователь', birth_date = '', phone = '' } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  try {
    const clientCode = `${Math.floor(100 + Math.random()*900)}-${Math.floor(100 + Math.random()*900)}`;

    await pool.query(
      `INSERT INTO client (user_id, full_name, birth_date, phone, reg_date, client_code, role)
       VALUES ($1,$2,$3,$4,NOW(),$5,'client')
       ON CONFLICT (user_id) DO NOTHING`,
      [user_id, full_name, birth_date, phone, clientCode]
    );

    const r = await pool.query(
      `SELECT user_id, full_name, phone, birth_date, client_code, bonus_balance, role, reg_date
       FROM client WHERE user_id=$1`,
      [user_id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'SERVER_ERROR', details: e.message });
  }
});

app.put('/api/user/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const { full_name, birth_date, phone } = req.body || {};
  try {
    await pool.query(
      `UPDATE users SET full_name=$1, birth_date=$2, phone=$3 WHERE user_id=$4`,
      [full_name, birth_date, phone, user_id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'SERVER_ERROR', details: e.message });
  }
});

app.get('/api/doctors', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM doctors ORDER BY id ASC');
    res.json(result.rows);
  } catch (e) {
    console.error('Ошибка /doctors:', e);
    res.status(500).json({ error: 'Ошибка при получении врачей' });
  }
});

app.get('/api/specialties', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM specialties ORDER BY id ASC');
    res.json(result.rows);
  } catch (e) {
    console.error('Ошибка /specialties:', e);
    res.status(500).json({ error: 'Ошибка при получении специальностей' });
  }
});

app.get('/api/doctor-services', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM doctor_services ORDER BY doctor_id ASC, service_id ASC');
        console.log('SERVICES_DOC',result)

    res.json(result.rows);
  } catch (e) {
    console.error('Ошибка /doctor-services:', e);
    res.status(500).json({ error: 'Ошибка при получении связей врач-услуга' });
  }
});

app.get('/api/services', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM services ORDER BY id ASC');
    console.log('SERVICES',result)
    res.json(result.rows);
  } catch (e) {
    console.error('Ошибка /services:', e);
    res.status(500).json({ error: 'Ошибка при получении услуг' });
  }
});

app.get('/api/availability', async (req, res) => {
  const { doctor_id, month, date_from, date_to } = req.query || {};
  if (!doctor_id) return res.status(400).json({ error: 'doctor_id required' });

  // период
  let from = date_from;
  let to   = date_to;

  // если передали month=YYYY-MM — считаем границы месяца
  if (month) {
    const [Y, M] = month.split('-').map(Number);
    const d0 = new Date(Y, (M - 1), 1);
    const d1 = new Date(Y, (M - 1) + 1, 1);
    from = from || `${d0.getFullYear()}-${pad2(d0.getMonth() + 1)}-01`;
    to   = to   || `${d1.getFullYear()}-${pad2(d1.getMonth() + 1)}-01`;
  }
  if (!from || !to) {
    return res.status(400).json({ error: 'period required (month or date_from/date_to)' });
  }

  try {
    const identsQ = await pool.query(
      `SELECT DISTINCT ident_staff_id::text AS ident
         FROM public.doctor_schedule
        WHERE doctor_id::text = $1`,
      [doctor_id]
    );
    const identIds = identsQ.rows.map(r => r.ident);
    if (!identIds.length) {
      return res.json({ doctor_id, month, days: {} });
    }

    const schedQ = await pool.query(
      `SELECT date::date AS d, time, is_available
         FROM public.doctor_schedule
        WHERE ident_staff_id::text = ANY($1::text[])
          AND date >= $2::date AND date < $3::date
          AND is_available = true
        ORDER BY date ASC, time ASC`,
      [identIds, from, to]
    );

    const busyQ = await pool.query(
      `SELECT id_patients, id_staffs::text AS ident, planstart, planend
         FROM public.ident_receptions
        WHERE id_staffs::text = ANY($1::text[])
          AND planstart::timestamp >= $2::timestamp
          AND planstart::timestamp <  $3::timestamp`,
      [identIds, from, to]
    );


    const availabilityDay = new Map();

    for (const row of schedQ.rows) {
      const iso = row.d.toISOString().slice(0, 10); 
      const [startMin, endMin] = parseTimeRange(row.time);
      if (endMin <= startMin) continue;

      if (!availabilityDay.has(iso)) availabilityDay.set(iso, new Set());
      const s = availabilityDay.get(iso);

      for (let m = startMin; m < endMin; m += 15) {
        const q = Math.floor(m / 15);
        if (q >= 0 && q < 96) s.add(q);
      }
    }

    for (const row of busyQ.rows) {
      const start = new Date(row.planstart);
      const end   = new Date(row.planend);
      if (!(start instanceof Date) || !(end instanceof Date)) continue;

      const iso = start.toISOString().slice(0, 10);
      if (!availabilityDay.has(iso)) continue;

      const s = availabilityDay.get(iso);
      const startMin = start.getHours() * 60 + start.getMinutes();
      const endMin   = end.getHours() * 60 + end.getMinutes();

      for (let m = startMin; m < endMin; m += 15) {
        const q = Math.floor(m / 15);
        s.delete(q);
      }
    }

    const daysOut = {};
for (const [iso, setQ] of availabilityDay.entries()) {
  const slots = [];
  for (let i = 0; i <= 94; i += 2) {                     
    if (setQ.has(i) && setQ.has(i + 1)) {               
      slots.push(timeFromMins(i * 15));                 
    }
  }
  if (slots.length) daysOut[iso] = slots;
}

    res.json({
      doctor_id,
      month: month || undefined,
      date_from: from,
      date_to: to,
      days: daysOut
    });
  } catch (e) {
    console.error('availability error:', e);
    res.status(500).json({ error: 'SERVER_ERROR', details: e.message });
  }
});

app.listen(port, '0.0.0.0', () => {})

