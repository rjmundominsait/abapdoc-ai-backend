const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// Motor de extracción estática completa (analiza el 100% del código sin gastar tokens)
function analyzeAbapDependencies(code) {
    const includes = new Set();
    const tables = new Set();
    const bapis = new Set();
    const forms = new Set();

    const includeRegex = /\bINCLUDE\s+([a-zA-Z0-9_/]+)/gi;
    let match;
    while ((match = includeRegex.exec(code)) !== null) {
        includes.add(match[1].toUpperCase());
    }

    const tableRegex = /\b(?:FROM|INTO|UPDATE|INTO TABLE|FROM TABLE|JOIN)\s+([a-zA-Z0-9_/]+)/gi;
    while ((match = tableRegex.exec(code)) !== null) {
        const tableName = match[1].toUpperCase();
        if (!['CORRESPONDING', 'TABLE', 'FIELDS', 'CLIENT', 'SPECIFIED', 'DBTABLE', 'SCREEN', 'MEMORY'].includes(tableName)) {
            tables.add(tableName);
        }
    }

    const bapiRegex = /\bCALL\s+FUNCTION\s+['"]([a-zA-Z0-9_/]+)['"]/gi;
    while ((match = bapiRegex.exec(code)) !== null) {
        bapis.add(match[1].toUpperCase());
    }

    const formRegex = /\bFORM\s+([a-zA-Z0-9_/]+)/gi;
    while ((match = formRegex.exec(code)) !== null) {
        forms.add(match[1].toUpperCase());
    }

    // Limpiamos comentarios y líneas en blanco para aprovechar al máximo los tokens útiles
    const cleanCode = code
        .split('\n')
        .filter(line => !line.trim().startsWith('*') && !line.trim().startsWith('"') && line.trim().length > 0)
        .join('\n');

    return {
        includes: Array.from(includes),
        tables: Array.from(tables),
        bapis: Array.from(bapis),
        forms: Array.from(forms),
        cleanCode
    };
}

// Endpoint: Resolución inteligente de Transacciones (TCode)
app.post('/api/resolve-tcode', async (req, res) => {
    const { inputName } = req.body;
    let cleanInput = (inputName || '').trim().toUpperCase();

    if (!cleanInput) {
        return res.status(400).json({ success: false, error: 'Falta el nombre de objeto o transacción.' });
    }

    try {
        const prompt = `Analiza "${cleanInput}". Devuelve ÚNICAMENTE el nombre técnico del programa ejecutable o clase ABAP estándar, sin texto ni markdown, solo el nombre en mayúsculas.`;

        const aiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'openai/gpt-oss-20b',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1
            })
        });

        if (!aiResponse.ok) {
            return res.json({ success: true, resolvedName: cleanInput });
        }

        const aiData = await aiResponse.json();
        let guessedName = aiData.choices?.[0]?.message?.content?.trim().toUpperCase();
        guessedName = guessedName ? guessedName.replace(/[^A-Z0-9_/]/g, '') : cleanInput;

        res.json({ success: true, resolvedName: guessedName || cleanInput });
    } catch (error) {
        res.json({ success: true, resolvedName: cleanInput });
    }
});

// Endpoint: Generación garantizada bajo techo estricto de 8.000 TPM
app.post('/api/generate-docs', async (req, res) => {
    const { processDescription, objectsData } = req.body;

    if (!objectsData || objectsData.length === 0) {
        return res.status(400).json({ success: false, error: 'Faltan objetos para documentar.' });
    }

    try {
        let globalDependencies = { includes: [], tables: [], bapis: [], forms: [] };
        const analyzedObjects = objectsData.map(obj => {
            const analysis = analyzeAbapDependencies(obj.code);
            globalDependencies.includes.push(...analysis.includes);
            globalDependencies.tables.push(...analysis.tables);
            globalDependencies.bapis.push(...analysis.bapis);
            globalDependencies.forms.push(...analysis.forms);
            return { ...obj, analysis };
        });

        globalDependencies.includes = [...new Set(globalDependencies.includes)];
        globalDependencies.tables = [...new Set(globalDependencies.tables)];
        globalDependencies.bapis = [...new Set(globalDependencies.bapis)];
        globalDependencies.forms = [...new Set(globalDependencies.forms)];

        // Presupuesto máximo total de código: 11.000 caracteres (~3.200 tokens)
        // Así la petición completa NUNCA superará los 5.500 tokens (límite Groq: 8.000 TPM)
        const MAX_TOTAL_CODE_CHARS = 11000;
        const charsPerObject = Math.max(400, Math.floor(MAX_TOTAL_CODE_CHARS / analyzedObjects.length));

        let combinedCodeSummary = '';
        analyzedObjects.forEach((obj, idx) => {
            if (combinedCodeSummary.length >= MAX_TOTAL_CODE_CHARS) return;

            const snippet = obj.analysis.cleanCode.length > charsPerObject
                ? obj.analysis.cleanCode.substring(0, charsPerObject) + '\n... [extracto] ...'
                : obj.analysis.cleanCode;

            combinedCodeSummary += `\n--- [${idx + 1}] ${obj.name} (${obj.type}) | Subrutinas: ${obj.analysis.forms.slice(0, 10).join(', ') || 'N/A'} ---\n${snippet}\n`;
        });

        console.log(`📦 Enviando petición blindada: ${analyzedObjects.length} objetos | Tamaño código: ${combinedCodeSummary.length} chars`);

        const prompt = `
Actúa como un Consultor Funcional y Arquitecto Técnico SAP S/4HANA Senior.
Redacta una Especificación Funcional y Técnica clara (comprensible tanto para negocio como para desarrollo) en HTML limpio (sin bloques markdown como \`\`\`html).

Datos extraídos del análisis completo del proceso:
- Contexto / Descripción funcional: "${processDescription || 'Proceso estándar/Z SAP'}"
- Componentes analizados (${analyzedObjects.length}): ${analyzedObjects.map(o => o.name).join(', ')}
- Includes relacionados: ${globalDependencies.includes.slice(0, 30).join(', ') || 'Ninguno'}
- Subrutinas / Métodos clave: ${globalDependencies.forms.slice(0, 30).join(', ') || 'Ninguno'}
- Tablas SAP accedidas: ${globalDependencies.tables.slice(0, 40).join(', ') || 'Ninguna'}
- Funciones / BAPIs invocadas: ${globalDependencies.bapis.slice(0, 25).join(', ') || 'Ninguna'}

Muestra representativa de lógica ABAP (sin comentarios):
${combinedCodeSummary}

Genera exactamente estas 5 secciones en HTML:
<h2>1. Resumen Ejecutivo y Objetivo Funcional</h2>
<p>Explicación clara orientada a negocio sobre qué resuelve este proceso y cuál es su finalidad operativa.</p>

<h2>2. Diagrama de Flujo del Proceso (Flujograma Secuencial)</h2>
<table style="width: 100%; border-collapse: collapse; margin: 15px 0; background-color: #f8fafc;">
    <tr>
        <td style="width: 30%; text-align: center; border: 1px solid #cbd5e1; padding: 10px; background: #ffffff;"><strong>1. Entrada / Selección</strong><br/><span style="font-size: 9pt; color: #64748b;">Datos y parámetros iniciales</span></td>
        <td style="width: 5%; text-align: center; border: none; font-size: 14pt; color: #0070f2;">➔</td>
        <td style="width: 30%; text-align: center; border: 1px solid #cbd5e1; padding: 10px; background: #ffffff;"><strong>2. Reglas y Lógica</strong><br/><span style="font-size: 9pt; color: #64748b;">Validaciones y tratamiento</span></td>
        <td style="width: 5%; text-align: center; border: none; font-size: 14pt; color: #0070f2;">➔</td>
        <td style="width: 30%; text-align: center; border: 1px solid #cbd5e1; padding: 10px; background: #ffffff;"><strong>3. Salida / Persistencia</strong><br/><span style="font-size: 9pt; color: #64748b;">Actualización o reporte</span></td>
    </tr>
</table>
<p>Explicación paso a paso del flujo funcional y técnico desde que el usuario lanza el proceso hasta su resultado final.</p>

<h2>3. Arquitectura y Relación de Objetos</h2>
<table>
    <tr><th>Componente / Objeto</th><th>Tipo</th><th>Rol Funcional y Técnico</th></tr>
    ${analyzedObjects.slice(0, 25).map(o => `<tr><td>${o.name}</td><td>${o.type}</td><td>Participa en el flujo principal del proceso</td></tr>`).join('')}
</table>

<h2>4. Lógica Detallada, Validaciones y Puntos Críticos</h2>
<p>Detalle de las reglas de negocio, validaciones sobre los datos, llamadas a BAPIs y posibles mensajes o bloqueos para el usuario.</p>

<h2>5. Tablas Afectadas y Consideraciones Clean Core</h2>
<p>Impacto en base de datos (${globalDependencies.tables.slice(0, 30).join(', ') || 'sin acceso directo a tablas'}) y recomendaciones S/4HANA.</p>
        `;

        // Ejecución con 1 reintento automático de 12s por si coincidiera con otra petición en el mismo minuto
        let response;
        for (let attempt = 1; attempt <= 2; attempt++) {
            response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'openai/gpt-oss-20b',
                    messages: [
                        { role: 'system', content: 'Eres un Consultor Funcional y Arquitecto SAP experto que genera documentación clara en HTML limpio.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.2,
                    max_tokens: 2200
                })
            });

            if (response.ok) break;

            const errText = await response.text();
            if (response.status === 429 && attempt === 1) {
                console.warn('⏳ Límite TPM momentáneo alcanzado. Esperando 15s antes de reintentar...');
                await new Promise(r => setTimeout(r, 15000));
                continue;
            }
            throw new Error(`Error Groq (${response.status}): ${errText}`);
        }

        const data = await response.json();
        let textResult = data.choices?.[0]?.message?.content;

        if (!textResult || textResult.trim().length === 0) {
            textResult = `
                <h2>1. Resumen Ejecutivo y Objetivo</h2>
                <p>Documentación generada a partir del análisis estructural de ${analyzedObjects.length} componentes SAP.</p>
                <h2>2. Tablas y Funciones Detectadas</h2>
                <p><b>Tablas:</b> ${globalDependencies.tables.join(', ') || 'Ninguna'}</p>
                <p><b>BAPIs / Funciones:</b> ${globalDependencies.bapis.join(', ') || 'Ninguna'}</p>
                <p><b>Subrutinas (FORM):</b> ${globalDependencies.forms.join(', ') || 'Ninguna'}</p>
            `;
        }

        res.json({ success: true, documentation: textResult });

    } catch (error) {
        console.error('Error detallado en backend:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Backend corriendo en puerto ${PORT}`);
});
