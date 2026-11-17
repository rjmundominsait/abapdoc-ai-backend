const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());
app.use(cors());

// Inicializar el SDK oficial de Google GenAI (necesita tu GEMINI_API_KEY en las variables de entorno)
const ai = new GoogleGenAI();

app.post('/api/generate-docs', async (req, res) => {
    const { objectName, abapCode } = req.body;

    if (!abapCode) {
        return res.status(400).json({ error: 'Falta el código ABAP' });
    }

    try {
        // Prompt estructurado para que la IA actúe como Arquitecto SAP
        const prompt = `
            Eres un Arquitecto Técnico SAP experto. Analiza el siguiente código fuente ABAP del objeto '${objectName}' y redacta una especificación técnica profesional en formato HTML limpio que incluya:
            1. Resumen funcional del programa.
            2. Tablas de Base de Datos (DDIC) o estructuras utilizadas.
            3. Lógica detallada paso a paso.
            4. Puntos críticos o recomendaciones Clean Core.

            Código ABAP:
            ${abapCode}
        `;

        // Llamada al modelo Gemini
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: prompt,
        });

        res.json({ success: true, documentation: response.text });

    } catch (error) {
        console.error('Error con la IA:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Backend de IA corriendo en http://localhost:${PORT}`);
});