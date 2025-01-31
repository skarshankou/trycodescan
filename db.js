const { Pool } = require('pg');

// Создаем пул соединений
const pool = new Pool({
    user: 'Ivan',
    host: '136.125.13.1',
    database: 'Pandora',
    password: '123456',
    port: 5432
});

// Функция для выполнения запроса
async function queryDatabase() {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT NOW()');
        console.log(res.rows[0]);
    } catch (err) {
        console.error('Error executing query', err.stack);
    } finally {
        client.release();
    }
}

// Вызов функции
queryDatabase().catch(err => console.error('Error connecting to the database', err.stack));
