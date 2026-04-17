export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { was, wo, umkreis, page, size } = req.query;

    const params = new URLSearchParams({
        was: was || '',
        wo: wo || '',
        umkreis: umkreis || '25',
        page: page || '1',
        size: size || '12',
        angebotsart: '1'
    });

    try {
        const response = await fetch(
            `https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/app/jobs?${params}`,
            {
                headers: {
                    'User-Agent': 'Jobsuche/2.9.2 (de.arbeitsagentur.jobboerse; build:1077; iOS 15.1.0) Alamofire/5.4.4',
                    'X-API-Key': 'jobboerse-jobsuche'
                }
            }
        );

        if (!response.ok) {
            return res.status(response.status).json({ error: 'BA API error' });
        }

        const data = await response.json();
        return res.status(200).json(data);

    } catch (err) {
        return res.status(500).json({ error: 'Proxy error', message: err.message });
    }
}