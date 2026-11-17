const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(cors());

// Función para indagar y extraer automáticamente dependencias del código ABAP
function analyzeAbapDependencies(code) {
    const includes = new Set();
    const tables = new Set();
    const bapis = new Set();

    // Regex para detectar includes: INCLUDE z... o INCLUDE zur...
    const includeRegex = /\bINCLUDE\s+([a-zA-Z0-9_/]+)/gi;
    let match;
    while ((match = includeRegex.exec(code)) !== null) {
        includes.add(match[1].toUpperCase());
    }

    // Regex para detectar tablas en SELECT, UPDATE, INSERT, MODIFY, DELETE
    const tableRegex = /\b(?:FROM|INTO|UPDATE|INTO TABLE|FROM TABLE|JOIN)\s+([a-zA-Z0-9_/]+)/gi;
    while ((match = tableRegex.exec(code)) !== null) {
        const tableName = match[1].toUpperCase();
        // Filtrar palabras reservadas comunes de ABAP para dejar solo tablas
        if (!['CORRESPONDING', 'TABLE', 'FIELDS', 'CLIENT', 'SPECIFIED', 'DBTABLE'].includes(tableName)) {
            tables.add(tableName);
        }
    }

    // Regex para detectar llamadas a funciones o BAPIs
    const bapiRegex = /\bCALL\s+FUNCTION\s+['"]([a-zA-Z0-9_/]+)['"]/gi;
    while ((match = bapiRegex.exec(code)) !== null) {
        bapis.add(match[1].toUpperCase());
    }

    return {
        includes: Array.from(includes),
        tables: Array.from(tables),
        bapis: Array.from(bapis)
    };
}

app.post('/api/generate-docs', async (req, res) => {
    const { processDescription, objectsData } = req.body;

    if (!objectsData || objectsData.length === 0) {
        return res.status(400).json({ success: false, error: 'Faltan objetos para documentar.' });
    }

    try {
        // 1. Unir código y extraer automáticamente dependencias ocultas
        let combinedCode = '';
        let globalDependencies = { includes: [], tables: [], bapis: [] };

        objectsData.forEach(obj => {
            combinedCode += `=== OBJETO PRINCIPAL / INCLUDE: ${obj.name} (${obj.type}) ===\n${obj.code}\n\n`;
            const deps = analyzeAbapDependencies(obj.code);
            globalDependencies.includes.push(...deps.includes);
            globalDependencies.tables.push(...deps.tables);
            globalDependencies.bapis.push(...deps.bapis);
        });

        // Limpiar duplicados
        globalDependencies.includes = [...new Set(globalDependencies.includes)];
        globalDependencies.tables = [...new Set(globalDependencies.tables)];
        globalDependencies.bapis = [...new Set(globalDependencies.bapis)];

        // 2. Construir un prompt inteligente y enriquecido para la IA
        const prompt = `
            Eres un Arquitecto Técnico SAP S/4HANA experto e investigador de código fuente. 
            Analiza en profundidad el siguiente proceso, el código fuente y las dependencias detectadas automáticamente.

            Contexto y Descripción aportada:
            "${processDescription || 'Análisis técnico end-to-end'}"

            Dependencias técnicas detectadas automáticamente en el código:
            - Includes identificados: ${globalDependencies.includes.join(', ') || 'Ninguno'}
            - Tablas / Vistas accedidas: ${globalDependencies.tables.join(', ') || 'Ninguna'}
            - BAPIs / Módulos de Funciones llamados: ${globalDependencies.bapis.join(', ') || 'Ninguno'}

            Códigos fuente fuente fuente:
            ${combinedCode}

            Genera una Especificación Técnica y Funcional exhaustiva en formato HTML limpio (sin bloques de código markdown como \`\`\`html), cumpliendo estrictamente con esta estructura:

            <h2>1. Resumen Ejecutivo y Objetivo del Negocio</h2>
            <p>Propósito del desarrollo, transacciones asociadas mencionadas y alcance general.</p>

            <h2>2. Diagrama de Flujo del Proceso (Flujograma Secuencial)</h2>
            <p>Esquema paso a paso detallado en formato HTML (Paso 1: Entrada/Transacción -> Paso 2: Validación -> Paso 3: Ejecución de Lógica en Includes/Clases -> Paso 4: Acceso a Base de Datos -> Paso 5: Salida).</p>

            <h2>3. Arquitectura, Relación de Includes y Objetos Involucrados</h2>
            <table>
                <tr><th>Componente / Include</th><th>Tipo</th><th>Propósito e Interacción detectada</th></tr>
            </table>

            <h2>4. Lógica Detallada y Puntos Críticos (Clean Core)</h2>
            <p>Explicación técnica de cómo se enlazan los includes analizados, validaciones clave, tratamiento de errores y llamadas a BAPIs.</p>

            <h2>5. Tablas Afectadas y Consideraciones de Rendimiento</h2>
            <p>Listado de tablas leídas/actualizadas y recomendaciones técnicas para S/4HANA.</p>
        `;

        // 3. Llamada al modelo operativo de Groq
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'openai/gpt-oss-20b',
                messages: [
                    { role: 'system', content: 'Eres un Arquitecto SAP experto que analiza código y dependencias, respondiendo únicamente en HTML limpio.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.2
            })
        });

        if (!response.ok) {
            const errData = await response.text();
            throw new Error(`Error Groq (${response.status}): ${errData}`);
        }

        const data = await response.json();
        const textResult = data.choices?.[0]?.message?.content || 'No se pudo generar contenido.';

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
