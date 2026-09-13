package fixture

private data class GlossaryEntry(
    val acronym: String,
    val definition: String,
    val note: String
)

private val glossaryEntries = listOf(
    GlossaryEntry(
        "AFM",
        "Aircraft Flight Manual",
        "Approved aircraft operating document. The AFM remains \"authoritative\" over app study content."
    ),
    GlossaryEntry("QRH", "Quick Reference Handbook", "Checklist reference."), // trailing comment with "quotes"
    GlossaryEntry(
        "SRS",
        "Spaced Repetition System",
        "Review scheduling."
    )
)
