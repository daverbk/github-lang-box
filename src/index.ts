import { Octokit } from '@octokit/rest'
import type { GetResponseDataTypeFromEndpointMethod } from '@octokit/types'
import { env } from './env.js'

const { GIST_ID, GH_TOKEN, GH_USERNAME, EXCLUDE, EXCLUDE_REPO } = env

const octokit = new Octokit({
    auth: `token ${GH_TOKEN}`,
})

type OctoRepo = GetResponseDataTypeFromEndpointMethod<
    typeof octokit.repos.listForAuthenticatedUser
>[number]

const truncate = (str: string, n: number) =>
    str.length > n ? `${str.substring(0, n - 1)}…` : str

const generateStatsLines = async (
    langTotal: Record<string, number>
): Promise<string[]> => {
    const top5 = Object.entries(langTotal)
        .filter(([lang]) => !EXCLUDE.includes(lang))
        .sort((a, b) => b[1] - a[1])

    const totalCode = top5.reduce((acc, [_, num]) => acc + num, 0)

    type LangPercentage = [language: string, percentage: number]
    type LangBarData = [language: string, percentage: number, barCount: number]

    const languagePercentages: LangPercentage[] = top5.map(
        ([lang, codeLines]) => [
            lang,
            Math.round((codeLines / totalCode) * 10000) / 100,
        ]
    )

    const langBarData: LangBarData[] = languagePercentages.map(
        ([language, percentage]) => [
            language,
            percentage,
            Math.ceil((percentage * 20) / 100),
        ]
    )

    const lines = langBarData.map(([language, percent, bars]) => {
        const languageLabel = truncate(`${language} `, 12).padStart(12)
        const barGraph = '█'.repeat(bars).padEnd(20, '░')
        const percentageLabel = `${percent.toFixed(2)}%`.padStart(6)
        return `${languageLabel}${barGraph} ${percentageLabel}`
    })

    return lines
}

const getRepoLanguage = async (repo: OctoRepo) => {
    if (repo.fork) return {}
    const { data: languages } = await octokit.repos.listLanguages({
        owner: GH_USERNAME,
        repo: repo.name,
    })
    return languages
}

const calculateTotalLanguages = async () => {
    const { data: repos } = await octokit.repos.listForAuthenticatedUser({
        type: 'owner',
        per_page: 100,
        sort: 'updated',
        direction: 'desc',
    })
    const langTotal: Record<string, number> = {}
    const reposTotalLanguages = await Promise.all(
        repos
            .filter((repo) => !EXCLUDE_REPO.includes(repo.full_name))
            .map((repo) => getRepoLanguage(repo))
    )
    reposTotalLanguages.forEach((lang) => {
        const keys = Object.keys(lang)
        keys.forEach((x) => {
            if (langTotal[x]) langTotal[x] += lang[x]
            else langTotal[x] = lang[x]
        })
    })
    return langTotal
}

const updateGist = async (lines: string) => {
    let gist: Awaited<ReturnType<typeof octokit.gists.get>>['data']
    try {
        gist = (await octokit.gists.get({ gist_id: GIST_ID })).data
    } catch (error) {
        throw new Error(`Unable to get gist\n${error}`)
    }
    const files = gist.files
    if (!files) throw new Error('No files found in the gist')
    const filename = Object.keys(files)[0]
    try {
        await octokit.gists.update({
            gist_id: GIST_ID,
            files: {
                [filename]: {
                    content: lines,
                },
            },
        })
    } catch (error) {
        throw new Error(`Unable to update gist\n${error}`)
    }
    console.log('Gist updated successfully!')
}

console.log('Calculating stats...')
const totalLang = await calculateTotalLanguages()
console.log('Total languages calculated')
console.log('Generating stats...')
const statsLine = (await generateStatsLines(totalLang)).join('\n')
console.log('Generated stats:')
console.log(statsLine)
if (process.argv.includes('--dry')) {
    console.log('Dry run, gist not updated')
} else {
    console.log('Updating gist...')
    await updateGist(statsLine)
}
