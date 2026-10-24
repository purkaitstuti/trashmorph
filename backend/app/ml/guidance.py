"""Suggested handling per category. General guidance only: local rules decide what is accepted."""
DISCLAIMER = "This is an automated suggestion and can be wrong. Local recycling rules vary, so check with your local authority before disposing of an item."

GUIDANCE: dict[str, tuple[str, str]] = {
    "plastic": ("Rinse it and check the recycling number against your local rules.", "Empty and rinse containers. Not every plastic type is accepted, so check what your area takes. Consider reuse first."),
    "paper": ("Keep it clean and dry, then put it in paper recycling.", "Remove plastic wrapping. Greasy or soiled paper usually can't be recycled."),
    "cardboard": ("Flatten it and keep it dry for cardboard recycling.", "Remove tape and packing where practical. Wet or food-soiled cardboard is often not accepted."),
    "glass": ("Empty and rinse it, then take it to glass recycling.", "Remove lids. Don't mix in ceramics, mirrors or window glass. Jars can often be reused."),
    "metal": ("Rinse cans and tins; larger metal can go to a scrap dealer.", "Clean foil and cans are widely recyclable. Scrap metal can sometimes be sold."),
    "organic": ("Compost it or use a food-waste collection if you have one.", "Remove packaging. Avoid meat and dairy in home compost."),
    "electronic": ("Take it to an e-waste collection point; don't put it in the bin.", "Wipe personal data first. Working items can often be repaired, donated or sold."),
    "textile": ("Donate wearable items; recycle worn-out textiles where offered.", "Wash and dry first. Repair, swap or donate before recycling."),
    "general": ("It may belong in general waste, but check for a reuse or recycling option first.", "If the item can't be reused or recycled locally, bag it securely for normal collection."),
    "other": ("We don't have specific guidance for this. Check the recycling guide or your local authority.", "Items like batteries, chemicals and medical waste need special handling. Don't put them in household bins."),
    "uncertain": ("We're not sure what this is. Try a clearer photo of a single item.", "Photograph one item against a plain background in good light, or look it up in the recycling guide."),
}


def guidance_for(category: str) -> tuple[str, str]:
    return GUIDANCE.get(category, GUIDANCE["other"])
