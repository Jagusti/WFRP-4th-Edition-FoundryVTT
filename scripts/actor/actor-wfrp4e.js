/**
 * Provides the main Actor data computation and organization.
 *
 * ActorWfrp4e contains all the preparation data and methods used for preparing an actor:
 * going through each Owned Item, preparing them for display based on characteristics.
 * Additionally, it handles all the different types of roll requests, setting up the
 * test dialog, how each test is displayed, etc.
 *
 *
 * @see   ActorSheetWfrp4e - Base sheet class
 * @see   ActorSheetWfrp4eCharacter - Character sheet class
 * @see   ActorSheetWfrp4eNPC - NPC sheet class
 * @see   ActorSheetWfrp4eCreature - Creature sheet class
 * @see   DiceWFRP4e - Sends test data to roll tests.
 */
class ActorWfrp4e extends Actor {

  /**
   * Override the create() function to provide additional WFRP4e functionality.
   *
   * This overrided create() function adds initial items and flags to an actor
   * upon creation. Namely: Basic skills, the 3 default coin values (brass
   * pennies, silver shillings, gold crowns) at a quantity of 0, and setting
   * up the default Automatic Calculation flags to be true. We still want to
   * use the upstream create method, so super.create() is called at the end.
   * Additionally - See the preCreateActor hook for more initial settings 
   * upon creation
   *
   * @param {Object} data        Barebones actor data which this function adds onto.
   * @param {Object} options     (Unused) Additional options which customize the creation workflow.
   *
   */
  static async create(data, options) {
    // If the created actor has items (only applicable to duplicated actors) bypass the new actor creation logic
    if (data.items)
    {
      super.create(data, options);
      return
    }

    // Initialize empty items
    data.items = [];

    // Default auto calculation to true
    data.flags =
    {
      autoCalcRun :  true,
      autoCalcWalk :  true,
      autoCalcWounds :  true,
      autoCalcCritW :  true,
      autoCalcCorruption :  true,
      autoCalcEnc :  true
    }
    let basicSkills = await WFRP_Utility.allBasicSkills();
    let moneyItems = await WFRP_Utility.allMoneyItems();

    // If character, automatically add basic skills and money items
    if (data.type == "character")
    {
      let id = 1;
      for (let sk of basicSkills) // Add basic skills
      {
        sk.id = id;
        id++;
        data.items.push(sk);
      }
      for (let m of moneyItems)   // Add money items, with a quantity of 0
      {
        m.id = id;
        id++;
        m.data.quantity.value = 0;
        data.items.push(m);
      }
      super.create(data, options); // Follow through the the rest of the Actor creation process upstream
    }
    // If not a character, ask the user whether they want to add basic skills / money
    else if (data.type == "npc" || data.type == "creature")
    {
      new Dialog({
        title: "Add Basic Skills",
        content: '<p>Add Basic Skills?</p>',
        buttons: {
          yes: {
            label: "Yes",
            callback: async dlg => {
              let id = 1;
              for (let sk of basicSkills) // Add basic skills
              {
                sk.id = id;
                id++;
                data.items.push(sk);
              }
              for (let m of moneyItems)   // Add the money items, with a quantity of 0
              {
                m.id = id;
                id++;
                m.data.quantity.value = 0;
                data.items.push(m);
              }
              super.create(data, options); // Follow through the the rest of the Actor creation process upstream
            }
          },
          no: {
            label: "No",
            callback: async dlg => {
              super.create(data, options); // Do not add new items, continue with the rest of the Actor creation process upstream
            }
          },
        },
        default: 'yes'
      }).render(true);
    }
  }


  /**
   * Calculates simple dynamic data when actor is updated.
   *
   * prepareData() is called when actor data is updated to recalculate values such as Characteristic totals, bonus (e.g.
   * this is how Strength total and Strength Bonus gets updated whenever the user changes the Strength characteristic),
   * movement values, and encumbrance. Some of these may or may not actually be calculated, depending on the user choosing
   * not to have them autocalculated. These values are relatively simple, more complicated calculations that require items
   * can be found in the sheet's getData() function.
   *
   * @see ActorSheetWfrp4e.getData()
   */
  prepareData()
  {
    try
    {
      super.prepareData();
      const data = this.data;

      // For each characteristic, calculate the total and bonus value
      for (let ch of Object.values(data.data.characteristics))
      {
        ch.value = ch.initial + ch.advances;
        ch.bonus = Math.floor(ch.value / 10)
      }

      // Only characters have experience
      if ( data.type === "character" )
        data.data.details.experience.current = data.data.details.experience.total - data.data.details.experience.spent;

      if (data.flags.autoCalcWalk)
        data.data.details.move.walk = parseInt(data.data.details.move.value)* 2;

      if (data.flags.autoCalcRun)
        data.data.details.move.run = parseInt(data.data.details.move.value) * 4;

      if (data.flags.autoCalcEnc)
        data.data.status.encumbrance.max = data.data.characteristics.t.bonus + data.data.characteristics.s.bonus;

      if (game.settings.get("wfrp4e", "capAdvantageIB"))
        data.data.status.advantage.max = data.data.characteristics.i.bonus
      else
        data.data.status.advantage.max = 10;

    }
    catch(error)
    {
      console.error("Something went wrong with preparing actor data: " + error)
      ui.notifications.error("Something went wrong with preparing actor data: " + error)
    }
  }

  /* --------------------------------------------------------------------------------------------------------- */
  /* Setting up Rolls
  /*
  /* All "setup______" functions gather the data needed to roll a certain test. These are in 3 main objects.
  /* These 3 objects are then given to DiceWFRP.prepareTest() to show the dialog, see that function for its usage.
  /*
  /* The 3 Main objects:
  /* testData - Data associated with modifications to rolling the test itself, or results of the test.
  /*            Examples of this are whether hit locations are found, Weapon qualities that may cause
                criticals/fumbles more often or ingredients for spells that cancel miscasts.
      dialogOptions - Data for rendering the dialog that's important for a specific test type.
                      Example: when casting or channelling, there should be an option for Malignant
                      Influences, but only for those tests.
      cardOptions - Which card to use, the title of the card, the name of the actor, etc.
  /* --------------------------------------------------------------------------------------------------------- */

  /**
   * Setup a Characteristic Test.
   *
   * Characteristics tests are the simplest test, all that needs considering is the target number of the
   * characteristic being tested, and any modifiers the user enters.
   *
   * @param {String} characteristicId     The characteristic id (e.g. "ws") - id's can be found in config.js
   *
   */
  setupCharacteristic(characteristicId) {
    let char = this.data.data.characteristics[characteristicId];
    let title = char.label + " Test";
    let testData = {
      target : char.value,
      hitLocation : false,
      extra : {
        size : this.data.data.details.size.value
      }
    };

    // Default a WS or BS test to have hit location checked
    if (characteristicId == "ws" || characteristicId == "bs")
      testData.hitLocation = true;

    // Setup dialog data: title, template, buttons, prefilled data
    let dialogOptions = {
      title: title,
      template : "/systems/wfrp4e/templates/chat/characteristic-dialog.html",
      buttons : {
        rollButton : {
          label: "Roll"
        }
      },
      // Prefilled dialog data
      data : {
        hitLocation : testData.hitLocation,
        talents : this.data.flags.talentTests,
        advantage : this.data.data.status.advantage.value || 0
      },
      callback : (html, roll) => {
        // When dialog confirmed, fill testData dialog information
        // Note that this does not execute until DiceWFRP.prepareTest() has finished and the user confirms the dialog
        cardOptions.rollMode =    html.find('[name="rollMode"]').val();
        testData.testModifier =   Number(html.find('[name="testModifier"]').val());
        testData.testDifficulty = WFRP4E.difficultyModifiers[html.find('[name="testDifficulty"]').val()];
        testData.successBonus =   Number(html.find('[name="successBonus"]').val());
        testData.slBonus =        Number(html.find('[name="slBonus"]').val());
        // Target value is the final value being tested against, after all modifiers and bonuses are added
        testData.target =         testData.target + testData.testModifier + testData.testDifficulty;
        testData.hitLocation =    html.find('[name="hitLocation"]').is(':checked');
        let talentBonuses =       html.find('[name = "talentBonuses"]').val();

          // Combine all Talent Bonus values (their times taken) into one sum
        testData.successBonus +=  talentBonuses.reduce(function (prev, cur){
          return prev + Number(cur)
        }, 0)

        // Use the assigned roll function (see DiceWFRP.prepareTest() to see how this roll function is assigned)
        roll(testData, cardOptions);
      }
    };

    // Call the universal cardOptions helper
    let cardOptions = this._setupCardOptions("systems/wfrp4e/templates/chat/characteristic-card.html", title)

    // Provide these 3 objects to prepareTest() to create the dialog and assign the roll function
    DiceWFRP.prepareTest({
      dialogOptions : dialogOptions,
      testData : testData,
      cardOptions : cardOptions
    });
  }

  /**
   * Setup a Skill Test.
   *
   * Skill tests are much like Characteristic Tests in their simplicity, just with another layer of modifiers (skill advances).
   * However, there is more complication if the skill is instead for an Income test, which adds computation after the roll is
   * completed.
   *
   * @param {Object} skill    The skill item being tested. Skill items contain the advancements and the base characteristic, see template.json for more information.
   * @param {bool}   income   Whether or not the skill is being tested to determine Income.
   */
  setupSkill(skill, income = false) {
    let title = skill.name + " Test";
    let testData = {
      hitLocation : false,
      income : income,
      extra : {
        size : this.data.data.details.size.value
      }
    };

    // Default a WS, BS, Melee, or Ranged to have hit location checked
    if (skill.data.characteristic.value == "ws" ||
        skill.data.characteristic.value == "bs" ||
        skill.name.includes("Melee") ||
        skill.name.includes("Ranged"))
    {
      testData.hitLocation = true;
    }

    // Setup dialog data: title, template, buttons, prefilled data
    let dialogOptions = {
      title: title,
      template : "/systems/wfrp4e/templates/chat/skill-dialog.html",
      buttons : {
        rollButton : {
          label: "Roll"
        }
      },
      // Prefilled dialog data
      data : {
        hitLocation : testData.hitLocation,
        talents : this.data.flags.talentTests,
        characteristicList : WFRP4E.characteristics,
        characteristicToUse : skill.data.characteristic.value,
        advantage : this.data.data.status.advantage.value || 0,
        testDifficulty : income ? "average" : "challenging" // Default to average if using income
      },
      callback : (html, roll) => {
        // When dialog confirmed, fill testData dialog information
        // Note that this does not execute until DiceWFRP.prepareTest() has finished and the user confirms the dialog
        cardOptions.rollMode =    html.find('[name="rollMode"]').val();
        testData.testModifier =   Number(html.find('[name="testModifier"]').val());
        testData.testDifficulty = WFRP4E.difficultyModifiers[html.find('[name="testDifficulty"]').val()];
        testData.successBonus =   Number(html.find('[name="successBonus"]').val());
        testData.slBonus =        Number(html.find('[name="slBonus"]').val());
        let characteristicToUse = html.find('[name="characteristicToUse"]').val();
        // Target value is the final value being tested against, after all modifiers and bonuses are added
        testData.target =
        this.data.data.characteristics[characteristicToUse].value
        + testData.testModifier
        + testData.testDifficulty
        + skill.data.advances.value;

        testData.hitLocation =    html.find('[name="hitLocation"]').is(':checked');
        let talentBonuses =       html.find('[name = "talentBonuses"]').val();

          // Combine all Talent Bonus values (their times taken) into one sum
        testData.successBonus +=  talentBonuses.reduce(function (prev, cur) {
          return prev + Number(cur)
        }, 0)

        // Use the assigned roll function (see below for how rollOverride is assigned, and then
        // DiceWFRP.prepareTest() for more info on how the override is used, if any)
        roll(testData, cardOptions)
      }
    };

    // If Income, use the specialized income roll handler
    if (testData.income)
      dialogOptions.rollOverride = this.constructor.incomeOverride;

    // Call the universal cardOptions helper
    let cardOptions = this._setupCardOptions("systems/wfrp4e/templates/chat/skill-card.html", title)

    // Provide these 3 objects to prepareTest() to create the dialog and assign the roll function
    DiceWFRP.prepareTest({
      dialogOptions : dialogOptions,
      testData : testData,
      cardOptions : cardOptions});
  }

  /**
   * Setup a Weapon Test.
   *
   * Probably the most complicated type of Test, weapon tests' complexity comes from all the different
   * factors and variables of the different weapons available and how they might affect test results,
   * as well as ammo usage, the effects of using different skills etc.
   *
   * @param {Object} weapon   The weapon Item being used.
   * @param {bool}   event    The event that called this Test, used to determine if attack is melee or ranged.
   */
  setupWeapon(weapon, event) {
    let skillCharList = []; // This array is for the different options available to roll the test (Skills and characteristics)
    let slBonus = 0   // Used when wielding Defensive weapons
    let modifier = 0; // Used when atatcking with Accurate weapons
    let successBonus = 0;
    let title = "Weapon Test - " + weapon.name;

    // Prepare the weapon to have the complete data object, including qualities/flaws, damage value, etc.
    let wep = this.prepareWeaponCombat(duplicate(weapon));
    let ammo; // Ammo object, if needed

    let testData = {
      target : 0,
      hitLocation : true,
      extra : { // Store this extra weapon/ammo data for later use
        weapon : wep,
        ammo : ammo,
        attackType : event.attackType,
        size : this.data.data.details.size.value
      }
    };

    if (event.attackType == "melee")
      skillCharList.push("Weapon Skill")

    else if (event.attackType == "ranged")
    {
      // If Ranged, default to Ballistic Skill, but check to see if the actor has the specific skill for the weapon
      skillCharList.push("Ballistic Skill")
      if (weapon.data.weaponGroup.value != "throwing" && weapon.data.weaponGroup.value != "explosives" && weapon.data.weaponGroup.value != "entangling")
      {
        // Check to see if they have ammo if appropriate
        ammo = this.getOwnedItem(weapon.data.currentAmmo.value);
        if (ammo)
          ammo = ammo.data
        if (!ammo || weapon.data.currentAmmo.value == 0 || ammo.data.quantity.value == 0)
        {
          ui.notifications.error("No Ammo!")
          return
        }
      }
      else if (weapon.data.quantity.value == 0)
      {
        // If this executes, it means it uses its own quantity for ammo (e.g. throwing), which it has none of
        ui.notifications.error("No Ammo!")
        return;
      }
      else
      {
        // If this executes, it means it uses its own quantity for ammo (e.g. throwing)
        ammo = weapon;
      }
    }

    let defaultSelection // The default skill/characteristic being used
    if (wep.skillToUse)
    {
        // If the actor has the appropriate skill, default to that.
        skillCharList.push(wep.skillToUse.name)
        defaultSelection = skillCharList.indexOf(wep.skillToUse.name)
    }

    // ***** Automatic Test Data Fill Options ******

    // Try to automatically fill the dialog with values based on context
    // If the auto-fill setting is true, and there is combat....
    if (game.settings.get("wfrp4e", "testAutoFill") && (game.combat && game.combat.data.round != 0 && game.combat.turns))
    {
      try
      {
        let currentTurn = game.combat.turns.find(t => t.active)

        // If actor is a token
        if (this.data.token.actorLink)
        {
          // If it is NOT the actor's turn
          if (currentTurn && this.data.token != currentTurn.actor.data.token)
            slBonus = this.data.flags.defensive; // Prefill Defensive values (see prepareItems() for how defensive flags are assigned)

          else // If it is the actor's turn
          {
            // Prefill dialog according to qualities/flaws
            if (wep.properties.qualities.includes("Accurate"))
              modifier += 10;
            if (wep.properties.qualities.includes("Precise"))
              successBonus += 1;
            if (wep.properties.flaws.includes("Imprecise"))
              slBonus -= 1;
          }
        }
        else // If the actor is not a token
        {
          // If it is NOT the actor's turn
          if (currentTurn && currentTurn.tokenId != this.token.id)
            slBonus = this.data.flags.defensive;

          else // If it is the actor's turn
          {
            // Prefill dialog according to qualities/flaws
            if (wep.properties.qualities.includes("Accurate"))
              modifier += 10;
            if (wep.properties.qualities.includes("Precise"))
              successBonus += 1;
            if (wep.properties.flaws.includes("Imprecise"))
              slBonus -= 1;
          }
        }
      }
      catch // If something went wrong, default to 0 for all prefilled data
      {
        slBonus = 0;
        successBonus = 0;
        modifier = 0;
      }
    }

    // Setup dialog data: title, template, buttons, prefilled data
    let dialogOptions = {
      title: title,
      template : "/systems/wfrp4e/templates/chat/weapon-dialog.html",
      buttons : {
        rollButton : {
          label: "Roll"
        }
      },
      // Prefilled dialog data
      data : {
        hitLocation : testData.hitLocation,
        talents : this.data.flags.talentTests,
        skillCharList : skillCharList,
        slBonus : slBonus || 0,
        successBonus : successBonus || 0,
        modifier : modifier || 0,
        defaultSelection : defaultSelection,
        testDifficulty : event.difficulty,
        advantage : this.data.data.status.advantage.value || 0
      },
      callback : (html, roll) => {
        // When dialog confirmed, fill testData dialog information
        // Note that this does not execute until DiceWFRP.prepareTest() has finished and the user confirms the dialog
        cardOptions.rollMode =    html.find('[name="rollMode"]').val();
        testData.testModifier =   Number(html.find('[name="testModifier"]').val());
        testData.testDifficulty = WFRP4E.difficultyModifiers[html.find('[name="testDifficulty"]').val()];
        testData.successBonus =   Number(html.find('[name="successBonus"]').val());
        testData.slBonus =        Number(html.find('[name="slBonus"]').val());
        let skillSelected =       skillCharList[Number(html.find('[name="skillSelected"]').val())];

        // Determine final target if a characteristic was selected
        if (skillSelected == "Weapon Skill" || skillSelected == "Ballistic Skill")
        {
          if (skillSelected == "Weapon Skill")
            testData.target = this.data.data.characteristics.ws.value
          else if (skillSelected == "Ballistic Skill")
            testData.target = this.data.data.characteristics.bs.value

          testData.target += testData.testModifier + testData.testDifficulty;
        }
        else // If a skill was selected
        {
          // If using the appropriate skill, set the target number to characteristic value + advances + modifiers
          // Target value is the final value being tested against, after all modifiers and bonuses are added
          let skillUsed = testData.extra.weapon.skillToUse;

          testData.target =
          this.data.data.characteristics[skillUsed.data.characteristic.value].value
          + testData.testModifier
          + testData.testDifficulty
          + skillUsed.data.advances.value;
        }

        testData.hitLocation = html.find('[name="hitLocation"]').is(':checked');

        let talentBonuses = html.find('[name = "talentBonuses"]').val();

        // Combine all Talent Bonus values (their times taken) into one sum
        testData.successBonus += talentBonuses.reduce(function (prev, cur){
          return prev + Number(cur)
        }, 0)

        // Use the assigned roll function (see below for how rollOverride is assigned, and then
        // DiceWFRP.prepareTest() for more info on how the override is used, if any)
        roll(testData, cardOptions);

        // Reduce ammo if necessary
        if (ammo && skillSelected != "Weapon Skill" && weapon.data.weaponGroup.value != "Entangling")
        {
          ammo.data.quantity.value--;
          this.updateOwnedItem({id: ammo.id, "data.quantity.value" : ammo.data.quantity.value });
        }
      },

      // Override the default test evaluation to use specialized rollWeaponTest function
      rollOverride : this.constructor.weaponOverride
    };

    // Call the universal cardOptions helper
    let cardOptions = this._setupCardOptions("systems/wfrp4e/templates/chat/weapon-card.html", title)

    // Provide these 3 objects to prepareTest() to create the dialog and assign the roll function
    DiceWFRP.prepareTest({
      dialogOptions : dialogOptions,
      testData : testData,
      cardOptions : cardOptions});
  }


  /**
   * Display a dialog for the user to choose casting or channelling.
   *
   * When clicking on a spell, the user will get an option to Cast or Channell that spell
   * Each option leads to their respective "setup" functions.
   *
   * @param {Object} spell     The spell item clicked on, petty spells will automatically be Casted, without the option to channell.
   *
   */
  spellDialog(spell) {
    // Do not show the dialog for Petty spells, just cast it.
    if (spell.data.lore.value == "petty")
      this.setupCast(spell, options)
    else
    {
      renderTemplate("systems/wfrp4e/templates/chat/cast-channel-dialog.html").then(dlg => {
        new Dialog({
          title: "Cast or Channell",
          content: dlg,
          buttons: {
            cast: {
              label: "Cast",
              callback: btn => {
                this.setupCast(spell);
              }
            },
            channell: {
              label: "Channell",
              callback: btn => {
                this.setupChannell(spell);
              }
            },
          },
          default: 'cast'
        }).render(true);
      })
    }
  }

  /**
   * Setup a Casting Test.
   *
   * Casting tests are more complicated due to the nature of spell miscasts, ingredients, etc. Whatever ingredient
   * is selected will automatically be used and negate one miscast. For the spell rolling logic, see DiceWFRP.rollCastTest
   * where all this data is passed to in order to calculate the roll result.
   *
   * @param {Object} spell    The spell Item being Casted. The spell item has information like CN, lore, and current ingredient ID
   *
   */
  setupCast(spell) {
    let title = "Casting Test - " + spell.name;

    // castSkill array holds the available skills/characteristics to cast with - Casting: Intelligence
    let castSkills = [{key : "int", name : "Intelligence"}]

    // if the actor has Language (Magick), add it to the array.
    castSkills = castSkills.concat(this.items.filter(i => i.name.toLowerCase() == "language (magick)" && i.type == "skill"))

    // Default to Language Magick if it exists
    let defaultSelection = castSkills.findIndex(i => i.name.toLowerCase() == "language (magick)")

    // Whether the actor has Instinctive Diction is important in the test rolling logic
    let instinctiveDiction = (this.data.flags.talentTests.findIndex(x=>x.talentName.toLowerCase() == "instinctive diction") > -1) // instinctive diction boolean

    // Prepare the spell to have the complete data object, including damage values, range values, CN, etc.
    let preparedSpell = this.prepareSpellOrPrayer(spell);
    let testData = {
      target : 0,
      extra : { // Store this data to be used by the test logic
        spell : preparedSpell,
        malignantInfluence : false,
        ingredient : false,
        ID : instinctiveDiction,
        size : this.data.data.details.size.value
      }
    };

    // If the spell does damage, default the hit location to checked
    if (preparedSpell.damage)
      testData.hitLocation = true;

    // Setup dialog data: title, template, buttons, prefilled data
    let dialogOptions = {
      title: title,
      template : "/systems/wfrp4e/templates/chat/spell-dialog.html",
      buttons : {
        rollButton : {
          label: "Roll"
        },
      },
      // Prefilled dialog data
      data : {
        hitLocation : testData.hitLocation,
        malignantInfluence : testData.malignantInfluence,
        talents : this.data.flags.talentTests,
        advantage : this.data.data.status.advantage.value || 0,
        defaultSelection : defaultSelection,
        castSkills : castSkills
      },
      callback : (html, roll) => {
        // When dialog confirmed, fill testData dialog information
        // Note that this does not execute until DiceWFRP.prepareTest() has finished and the user confirms the dialog
        cardOptions.rollMode =    html.find('[name="rollMode"]').val();
        testData.testModifier =   Number(html.find('[name="testModifier"]').val());
        testData.testDifficulty = WFRP4E.difficultyModifiers[html.find('[name="testDifficulty"]').val()];
        testData.successBonus =   Number(html.find('[name="successBonus"]').val());
        testData.slBonus =        Number(html.find('[name="slBonus"]').val());

        let skillSelected = castSkills[Number(html.find('[name="skillSelected"]').val())];

        // If an actual skill (Language Magick) was selected, use that skill to calculate the target number
        if (skillSelected.key != "int")
        {
          testData.target = this.data.data.characteristics[skillSelected.data.data.characteristic.value].value
          + skillSelected.data.data.advances.value
          + testData.testDifficulty
          + testData.testModifier;
        }
        else // if a characteristic was selected, use just the characteristic
        {
          testData.target = this.data.data.characteristics.int.value
          + testData.testDifficulty
          + testData.testModifier;
        }

        testData.hitLocation = html.find('[name="hitLocation"]').is(':checked');
        testData.extra.malignantInfluence = html.find('[name="malignantInfluence"]').is(':checked');

        let talentBonuses = html.find('[name = "talentBonuses"]').val();
        // Combine all Talent Bonus values (their times taken) into one sum
        testData.successBonus += talentBonuses.reduce(function (prev, cur){
          return prev + Number(cur)
        }, 0)

        // Find ingredient being used, if any
        let ing = this.getOwnedItem(testData.extra.spell.data.currentIng.value)
        if (ing)
        {
          // Decrease ingredient quantity
          ing = ing.data;
          testData.extra.ingredient = true;
          ing.data.quantity.value--;
          this.updateOwnedItem(ing);
        }
        // If quantity of ingredient is 0, disregard the ingredient
        else if (!ing || ing.data.data.quantity.value <= 0)
          testData.extra.ingredient = false;

        // Use the assigned roll function (see below for how rollOverride is assigned, and then
        // DiceWFRP.prepareTest() for more info on how the override is used, if any)
        roll(testData, cardOptions);
      },
      // Override the default test evaluation to use specialized rollCastTest function
      rollOverride : this.constructor.castOverride
    };

    // Call the universal cardOptions helper
    let cardOptions = this._setupCardOptions("systems/wfrp4e/templates/chat/spell-card.html", title)

    // Provide these 3 objects to prepareTest() to create the dialog and assign the roll function
    DiceWFRP.prepareTest({
      dialogOptions : dialogOptions,
      testData : testData,
      cardOptions : cardOptions});
  }

  /**
   * Setup a Channelling Test.
   *
   * Channelling tests are more complicated due to the nature of spell miscasts, ingredients, etc. Whatever ingredient
   * is selected will automatically be used and mitigate miscasts. For the spell rolling logic, see DiceWFRP.rollChannellTest
   * where all this data is passed to in order to calculate the roll result.
   *
   * @param {Object} spell    The spell Item being Channelled. The spell item has information like CN, lore, and current ingredient ID
   * This spell SL will then be updated accordingly.
   *
   */
  setupChannell(spell) {
    let title = "Channelling Test - " + spell.name;

    // channellSkills array holds the available skills/characteristics to channell with - Channelling: Willpower
    let channellSkills = [{key : "wp", name : "Willpower"}]

    // if the actor has any channell skills, add them to the array.
    channellSkills = channellSkills.concat(this.items.filter(i => i.name.toLowerCase().includes("channel") && i.type == "skill"))

    // Find the spell lore, and use that to determine the default channelling selection
    let spellLore = spell.data.lore.value;
    let defaultSelection = channellSkills.indexOf(channellSkills.find(x => x.name.includes(WFRP4E.magicWind[spellLore])));

    if (spellLore == "witchcraft")
      defaultSelection = channellSkills.indexOf(channellSkills.find(x => x.name.includes("Channelling")))

    // Whether the actor has Aethyric Attunement is important in the test rolling logic
    let aethyricAttunement = (this.data.flags.talentTests.findIndex(x=>x.talentName.toLowerCase() == "aethyric attunement") > -1) // aethyric attunement boolean

    let testData = {
      target : 0,
      extra : { // Store data to be used by the test logic
        spell : this.prepareSpellOrPrayer(spell),
        malignantInfluence : false,
        ingredient : false,
        AA : aethyricAttunement,
        size : this.data.data.details.size.value
      }
    };

    // Setup dialog data: title, template, buttons, prefilled data
    let dialogOptions = {
      title: title,
      template : "/systems/wfrp4e/templates/chat/channell-dialog.html",
      buttons : {
        rollButton : {
          label: "Roll"
        }
      },
      // Prefilled dialog data
      data : {
        malignantInfluence : testData.malignantInfluence,
        channellSkills : channellSkills,
        defaultSelection: defaultSelection,
        talents : this.data.flags.talentTests,
        advantage : "N/A"
      },
      callback : (html, roll) => {
          // When dialog confirmed, fill testData dialog information
        // Note that this does not execute until DiceWFRP.prepareTest() has finished and the user confirms the dialog
        cardOptions.rollMode =    html.find('[name="rollMode"]').val();
        testData.testModifier =   Number(html.find('[name="testModifier"]').val());
        testData.testDifficulty = WFRP4E.difficultyModifiers[html.find('[name="testDifficulty"]').val()];
        testData.successBonus =   Number(html.find('[name="successBonus"]').val());
        testData.slBonus =        Number(html.find('[name="slBonus"]').val());
        testData.extra.malignantInfluence = html.find('[name="malignantInfluence"]').is(':checked');

        let skillSelected = channellSkills[Number(html.find('[name="skillSelected"]').val())];
        // If an actual Channelling skill was selected, use that skill to calculate the target number
        if (skillSelected.key != "wp")
        {
          testData.target = testData.testModifier + testData.testDifficulty
                            + this.data.data.characteristics[skillSelected.data.data.characteristic.value].value
                            + skillSelected.data.data.advances.value
          testData.extra.channellSkill = skillSelected.data
        }
        else // if the ccharacteristic was selected, use just the characteristic
          testData.target = testData.testModifier + testData.testDifficulty + this.data.data.characteristics.wp.value

        let talentBonuses = html.find('[name = "talentBonuses"]').val();
        // Combine all Talent Bonus values (their times taken) into one sum
        testData.successBonus += talentBonuses.reduce(function (prev, cur){
          return prev + Number(cur)
        }, 0)


        // Find ingredient being used, if any
        let ing = this.getOwnedItem(testData.extra.spell.data.currentIng.value)
        if (ing)
        {
          // Decrease ingredient quantity
          ing = ing.data;
          testData.extra.ingredient = true;
          ing.data.quantity.value--;
          this.updateOwnedItem(ing);
        }
        // If quantity of ingredient is 0, disregard the ingredient
        else if(!ing || ing.data.data.quantity.value <= 0)
          testData.extra.ingredient = false;

        // Use the assigned roll function (see below for how rollOverride is assigned, and then
        // DiceWFRP.prepareTest() for more info on how the override is used, if any)
        roll(testData, cardOptions);
      },
      // Override the default test evaluation to use specialized rollCastTest function
      rollOverride : this.constructor.channellOverride
    };

    // Call the universal cardOptions helper
    let cardOptions = this._setupCardOptions("systems/wfrp4e/templates/chat/channell-card.html", title)

    // Provide these 3 objects to prepareTest() to create the dialog and assign the roll function
    DiceWFRP.prepareTest({
      dialogOptions : dialogOptions,
      testData : testData,
      cardOptions : cardOptions});
  }

  /**
   * Setup a Prayer Test.
   *
   * Prayer tests are fairly simple, with the main complexity coming from sin and wrath of the gods,
   * the logic of which can be found in DiceWFRP.rollPrayerTest, where all this data here is passed
   * to in order to calculate the roll result.
   *
   * @param {Object} prayer    The prayer Item being used, compared to spells, not much information
   * from the prayer itself is needed.
   */
  setupPrayer(prayer) {
    let title = "Prayer Test - " + prayer.name;

    // ppraySkills array holds the available skills/characteristics to pray with - Prayers: Fellowship
    let praySkills = [{key : "fel", name : "Fellowship"}]

    // if the actor has the Pray skill, add it to the array.
    praySkills = praySkills.concat(this.items.filter(i => i.name.toLowerCase() == "pray" && i.type == "skill"));

    // Default to Pray skill if available
    let defaultSelection = praySkills.findIndex(i => i.name.toLowerCase() == "pray")

    // Prepare the prayer to have the complete data object, including damage values, range values, etc.
    let preparedPrayer = this.prepareSpellOrPrayer(prayer);
    let testData = { // Store this data to be used in the test logic
      target : 0,
      hitLocation : false,
      extra : {
        prayer : preparedPrayer,
        size : this.data.data.details.size.value
      }
    };


    // If the spell does damage, default the hit location to checked
    if (preparedPrayer.damage)
      testData.hitLocation = true;

    // Setup dialog data: title, template, buttons, prefilled data
    let dialogOptions = {
      title: title,
      template : "/systems/wfrp4e/templates/chat/prayer-dialog.html",
      buttons : {
        rollButton : {
          label: "Roll"
        }
      },
      // Prefilled dialog data
      data : {
        hitLocation : testData.hitLocation,
        talents : this.data.flags.talentTests,
        advantage : this.data.data.status.advantage.value || 0,
        praySkills : praySkills,
        defaultSelection : defaultSelection
      },
      callback : (html, roll) => {
        // When dialog confirmed, fill testData dialog information
        // Note that this does not execute until DiceWFRP.prepareTest() has finished and the user confirms the dialog
        cardOptions.rollMode =    html.find('[name="rollMode"]').val();
        testData.testModifier =   Number(html.find('[name="testModifier"]').val());
        testData.testDifficulty = WFRP4E.difficultyModifiers[html.find('[name="testDifficulty"]').val()];
        testData.successBonus =   Number(html.find('[name="successBonus"]').val());
        testData.slBonus =        Number(html.find('[name="slBonus"]').val());

        let skillSelected = praySkills[Number(html.find('[name="skillSelected"]').val())];
        // If an actual skill (Pray) was selected, use that skill to calculate the target number
        if (skillSelected.key != "fel")
        {
          testData.target = this.data.data.characteristics[skillSelected.data.data.characteristic.value].value
          + skillSelected.data.data.advances.value
          + testData.testDifficulty
          + testData.testModifier;
        }
        else // if a characteristic was selected, use just the characteristic
        {
          testData.target = this.data.data.characteristics.fel.value
          + testData.testDifficulty
          + testData.testModifier;
        }

        testData.hitLocation = html.find('[name="hitLocation"]').is(':checked');

        let talentBonuses = html.find('[name = "talentBonuses"]').val();
        // Combine all Talent Bonus values (their times taken) into one sum
        testData.successBonus += talentBonuses.reduce(function (prev, cur){
          return prev + Number(cur)
        }, 0)

        // Use the assigned roll function (see below for how rollOverride is assigned, and then
        // DiceWFRP.prepareTest() for more info on how the override is used, if any)
        roll(testData, cardOptions);
      },
      // Override the default test evaluation to use specialized rollPrayerTest function
      rollOverride : this.constructor.prayerOverride
    };

    // Call the universal cardOptions helper
    let cardOptions = this._setupCardOptions("systems/wfrp4e/templates/chat/prayer-card.html", title)

    // Provide these 3 objects to prepareTest() to create the dialog and assign the roll function
    DiceWFRP.prepareTest({
      dialogOptions : dialogOptions,
      testData : testData,
      cardOptions : cardOptions});
  }

  /**
   * Setup a Trait Test.
   *
   * Some traits are rollable, and so are assigned a rollable characteristic, this is where
   * rolling those characteristics is setup. Additonally, sometimes these traits have a
   * "Bonus characteristic" which in most all cases means what characteristic bonus to add
   * to determine damage. See the logic in traitOverride.
   *
   * @param {Object} trait   The trait Item being used, containing which characteristic/bonus characteristic to use
   */
  setupTrait(trait) {
    if (!trait.data.rollable.value)
      return;
    let title =   WFRP4E.characteristics[trait.data.rollable.rollCharacteristic] + " Test - " + trait.name;
    let testData = {
      hitLocation : false,
      extra : { // Store this trait data for later use
        trait : trait,
        size : this.data.data.details.size.value
      }
    };

    // Default hit location checked if the rollable trait's characteristic is WS or BS
    if (trait.data.rollable.rollCharacteristic == "ws" || trait.data.rollable.rollCharacteristic == "bs" )
      testData.hitLocation = true;

    // Setup dialog data: title, template, buttons, prefilled data
    let dialogOptions = {
      title: title,
      template : "/systems/wfrp4e/templates/chat/skill-dialog.html", // Reuse skill dialog
      buttons : {
        rollButton : {
          label: "Roll"
        }
      },
      // Prefilled dialog data
      data : {
        hitLocation : testData.hitLocation,
        talents : this.data.flags.talentTests,
        characteristicList : WFRP4E.characteristics,
        characteristicToUse : trait.data.rollable.rollCharacteristic,
        advantage : this.data.data.status.advantage.value || 0
      },
      callback : (html, roll) => {
        // When dialog confirmed, fill testData dialog information
        // Note that this does not execute until DiceWFRP.prepareTest() has finished and the user confirms the dialog
        cardOptions.rollMode =    html.find('[name="rollMode"]').val();
        testData.testModifier =   Number(html.find('[name="testModifier"]').val());
        testData.testDifficulty = WFRP4E.difficultyModifiers[html.find('[name="testDifficulty"]').val()];
        testData.successBonus =   Number(html.find('[name="successBonus"]').val());
        testData.slBonus =        Number(html.find('[name="slBonus"]').val());
        let characteristicToUse = html.find('[name="characteristicToUse"]').val();
        // Target value is the final value being tested against, after all modifiers and bonuses are added
        testData.target = this.data.data.characteristics[characteristicToUse].value
                              + testData.testModifier
                              + testData.testDifficulty
        testData.hitLocation = html.find('[name="hitLocation"]').is(':checked');
        let talentBonuses =    html.find('[name = "talentBonuses"]').val();

        // Combine all Talent Bonus values (their times taken) into one sum
        testData.successBonus += talentBonuses.reduce(function (prev, cur){
          return prev + Number(cur)
        }, 0)

        // Use the assigned roll function (see below for how rollOverride is assigned, and then
        // DiceWFRP.prepareTest() for more info on how the override is used, if any)
        roll(testData, cardOptions);
        },
      // Override the default test evaluation to use a specialized function to handle traits
      rollOverride : this.constructor.traitOverride
    };

    // Call the universal cardOptions helper
    let cardOptions = this._setupCardOptions("systems/wfrp4e/templates/chat/skill-card.html", title)

    // Provide these 3 objects to prepareTest() to create the dialog and assign the roll function
    DiceWFRP.prepareTest({
      dialogOptions : dialogOptions,
      testData : testData,
      cardOptions : cardOptions});
  }


  /**
   * Universal card options for setup functions.
   *
   * The setup_____() functions all use the same cardOptions, just different templates. So this is
   * a standardized helper function to maintain DRY code.
   *
   * @param {string} template   Fileptah to the template being used
   * @param {string} title      Title of the Test to be displayed on the dialog and card
   */
  _setupCardOptions(template, title)
  {
    let cardOptions = {
      speaker: {
        alias: this.data.token.name,
        actor : this.data._id,
      },
      title: title,
      template : template,
      flags : {img: this.data.token.randomImg ? this.data.img : this.data.token.img} 
      // img to be displayed next to the name on the test card - if it's a wildcard img, use the actor image
    }

    // If the test is coming from a token sheet
    if (this.token)
    {
      cardOptions.speaker.alias = this.token.data.name; // Use the token name instead of the actor name
      cardOptions.speaker.token = this.token.data.id;
      cardOptions.speaker.scene = canvas.scene.id
      cardOptions.flags.img = this.token.data.img; // Use the token image instead of the actor image
    }
    else // If a linked actor - use the currently selected token's data if the actor id matches
    {
      let speaker = ChatMessage.getSpeaker()
      if (speaker.actor == this.data._id)
      {
        cardOptions.speaker.alias = speaker.alias
        cardOptions.speaker.token = speaker.token
        cardOptions.speaker.scene = speaker.scene
      }
    }

    return cardOptions
  }

  /**
   * Adds all missing basic skills to the Actor.
   *
   * This function will add all mising basic skills, used when an Actor is created (see create())
   * as well as from the right click menu from the Actor directory.
   *
   */
  async addBasicSkills() {
    let allItems = duplicate(this.data.items)
    let ownedBasicSkills = allItems.filter(i => i.type == "skill" && i.data.advanced.value == "bsc");
    let allBasicSkills = await WFRP_Utility.allBasicSkills()

    // Filter allBasicSkills with ownedBasicSkills, resulting in all the missing skills
    let skillsToAdd = allBasicSkills.filter(s => !ownedBasicSkills.find(ownedSkill => ownedSkill.name == s.name))

    // Add those missing basic skills
    for(let skill of skillsToAdd)
    {
      await this.createOwnedItem(skill)
    }
  }


  /**
   * Apply damage to an actor, taking into account armor, size, and weapons.
   *
   * applyDamage() is typically called at the end of an oppposed tests, where you can
   * right click the chat message and apply damage. This function goes through the
   * process of calculating and reducing damage if needede based on armor, toughness,
   * size, armor qualities/flaws, and weapon qualities/flaws
   *
   * @param {Object} victim       id of actor taking damage
   * @param {Object} opposedData  Test results, all the information needed to calculate damage
   * @param {var}    damageType   enum for what the damage ignores, see config.js
   */
  static applyDamage(victim, opposeData, damageType = DAMAGE_TYPE.NORMAL)
  {
    // If no damage value, don't attempt anything
    if (!opposeData.damage.value)
      return "Cannot automate damage (likely due to Tiring)"

    // Get actor/tokens for those in the opposed test
    let actor = WFRP_Utility.getSpeaker(victim);
    let attacker = WFRP_Utility.getSpeaker(opposeData.speakerAttack)

    // Start wound loss at the damage value
    let totalWoundLoss = opposeData.damage.value
    let newWounds = actor.data.data.status.wounds.value;
    let applyAP = (damageType == DAMAGE_TYPE.IGNORE_TB || damageType == DAMAGE_TYPE.NORMAL)
    let applyTB = (damageType == DAMAGE_TYPE.IGNORE_AP || damageType == DAMAGE_TYPE.NORMAL)

    // Start message update string
    let updateMsg = "Damage Applied to <b>"+ actor.data.name + "</b><span class = 'hide-option'>: @TOTAL";
    if (damageType != DAMAGE_TYPE.IGNORE_ALL)
      updateMsg += " ("

    // If armor at hitloc has impenetrable value or not
    let impenetrable = false;
    // If weapon is undamaging
    let undamaging = false;
    // If weapon has Hack
    let hack

    if (applyAP)
    {
      // I dislike this solution but I can't think of any other way to do it
      // Prepare the entire actor to get the AP layers at the hitloc
      let AP = actor.sheet.getData().actor.AP[opposeData.hitloc.value]
      AP.ignored = 0;
      if (opposeData.attackerTestResult.weapon) // If the attacker is using a weapon
      {
        if (opposeData.attackerTestResult.weapon.properties.qualities.includes("Hack"))
          hack = true;
        // Determine its qualities/flaws to be used for damage calculation
        let weaponProperties = opposeData.attackerTestResult.weapon.properties;
        let penetrating = weaponProperties.qualities.includes("Penetrating")
        undamaging = weaponProperties.flaws.includes("Undamaging")
        // see if armor flaws should be triggered
        let ignorePartial = opposeData.attackerTestResult.roll % 2 == 0 || opposeData.attackerTestResult.extra.critical
        let ignoreWeakpoints = (opposeData.attackerTestResult.roll % 2 == 0 || opposeData.attackerTestResult.extra.critical)
                                && weaponProperties.qualities.includes("Impale")

        // Mitigate damage with armor one layer at a time
        for (let layer of AP.layers)
        {
          if (ignoreWeakpoints && layer.weakpoints)
          {
            AP.ignored += layer.value
          }
          else if (ignorePartial && layer.partial)
          {
            AP.ignored += layer.value;
          }
          else if (penetrating) // If penetrating - ignore 1 or all armor depending on material
          {
            AP.ignored += layer.metal ? 1 : layer.value
          }
        }
      } // end if weapon

      // Go through the layers again to determine the location is impenetrable
      // This is its own loop because it should be checked regardless of the
      // attacker using a weapon
      for (let layer of AP.layers)
      {
        if (opposeData.attackerTestResult.roll % 2 != 0 && layer.impenetrable)
        {
          impenetrable = true;
          break;
        }
      }
      // AP.used is the actual amount of AP considered
      AP.used = AP.value - AP.ignored
      AP.used = AP.used < 0 ? 0 : AP.used;           // AP minimum 0
      AP.used = undamaging ? AP.used * 2 : AP.used;  // Double AP if undamaging

      // show the AP usage in the updated message
      if (AP.ignored)
        updateMsg += `${AP.used}/${AP.value} AP`
      else
        updateMsg += AP.used + " AP"

      // If using a shield, add that APP as well
      let shieldAP = 0;
      if (opposeData.defenderTestResult.weapon)
      {
        if (opposeData.defenderTestResult.weapon.properties.qualities.find(q => q.includes("Shield")))
          shieldAP = Number(opposeData.defenderTestResult.weapon.properties.qualities.find(q => q.includes("Shield")).split(" ")[1])
      }

      if (shieldAP)
        updateMsg += ` + ${shieldAP} Shield`

      if (applyTB)
        updateMsg += " + "
      else
        updateMsg += ")"

      // Reduce damage done by AP
      totalWoundLoss -= (AP.used + shieldAP)
    }

    // Reduce damage by TB
    if (applyTB)
    {
      totalWoundLoss -= actor.data.data.characteristics.t.bonus
      updateMsg += actor.data.data.characteristics.t.bonus + " TB"
    }

    // If the actor has the Robust talent, reduce damage by times taken
    totalWoundLoss -= actor.data.flags.robust || 0;

    if (actor.data.flags.robust)
      updateMsg += ` + ${actor.data.flags.robust} Robust)`
    else
      updateMsg += ")"

    // Minimum 1 wound if not undamaging
    if (!undamaging)
      totalWoundLoss = totalWoundLoss <= 0 ? 1 : totalWoundLoss
    else
      totalWoundLoss = totalWoundLoss <= 0 ? 0 : totalWoundLoss

    newWounds -= totalWoundLoss

    // If damage taken reduces wounds to 0, show Critical
    if (newWounds <= 0 && !impenetrable)
      updateMsg += `<br><a class ="table-click critical-roll" data-table = "crit${opposeData.hitloc.value}" >Critical</a>`

    else if (impenetrable)
      updateMsg += `<br>Impenetrable - Criticals Nullified`

    if (hack)
      updateMsg += `<br>1 AP Damaged at ${opposeData.hitloc.value}`

    if (newWounds <= 0)
      newWounds = 0; // Do not go below 0 wounds


    updateMsg +="</span>"
    updateMsg = updateMsg.replace("@TOTAL", totalWoundLoss)

    // Update actor wound value
    actor.update({"data.status.wounds.value" : newWounds})
    return updateMsg;
  }


  /* --------------------------------------------------------------------------------------------------------- */
  /* --------------------------------------------- Roll Overides --------------------------------------------- */
  /* --------------------------------------------------------------------------------------------------------- */
  /**
   * Roll overrides are specialized functions for different types of rolls. In each override, DiceWFRP is called
   * to perform the test logic, which has its own specialized functions for different types of tests. For exapmle,
   * weaponOverride() calls DiceWFRP.rollWeaponTest(). Additionally, any post-roll logic that needs to be performed
   * is done here. For example, Income tests use incomeOverride, which determines how much money is made after the
   * roll is completed. A normal Skill Test does not go through this process, instead using defaultRoll override,
   * however both overrides just use the standard DiceWFRP.rollTest().
   *
  /* --------------------------------------------------------------------------------------------------------- */

  /**
   * Default Roll override, the standard rolling method for general tests.
   *
   * defaultRoll is the default roll override (see DiceWFRP.prepareTest() for where it's assigned). This follows
   * the basic steps. Call DiceWFRP.rollTest for standard test logic, send the result and display data to
   * DiceWFRP.renderRollCard() as well as handleOpposed().
   *
   * @param {Object} testData         All the data needed to evaluate test results - see setupSkill/Characteristic
   * @param {Object} cardOptions      Data for the card display, title, template, etc.
   * @param {Object} rerenderMessage  The message to be updated (used if editing the chat card)
   */
  static async  defaultRoll(testData, cardOptions, rerenderMessage = null) {
    let result = DiceWFRP.rollTest(testData);
    result.postFunction = "defaultRoll";
    if (testData.extra)
      mergeObject(result, testData.extra);


    if (game.user.targets.size)
        cardOptions.title += " - Opposed"

    await DiceWFRP.renderRollCard(cardOptions, result, rerenderMessage).then(msg => {
      ActorWfrp4e.handleOpposed(msg) // Send to handleOpposed to determine opposed status, if any.
    })
  }

  /**
   * incomeOverride is used to add income calculation to Skill tests.
   *
   * Normal skill Tests just use defaultRoll() override, however, when testing Income, this override is used instead
   * because it adds 'post processing' in the form of determining how much money was earned. See this.setupSkill()
   * for how this override is assigned.
   *
   * @param {Object} testData         All the data needed to evaluate test results - see setupSkill()
   * @param {Object} cardOptions      Data for the card display, title, template, etc.
   * @param {Object} rerenderMessage  The message to be updated (used if editing the chat card)
   */
  static async incomeOverride(testData, cardOptions, rerenderMessage = null)
  {
    let result = DiceWFRP.rollTest(testData);
    result.postFunction = "incomeOverride"

    if (game.user.targets.size)
        cardOptions.title += " - Opposed"

    let dieAmount = WFRP4E.earningValues[testData.income.tier][0] // b, s, or g maps to 2d10, 1d10, or 1 respectively (takes the first letter)
    dieAmount = Number(dieAmount) * testData.income.standing;     // Multilpy that first letter by your standing (Brass 4 = 8d10 pennies)
    let moneyEarned;
    if (testData.income.tier != "g") // Don't roll for gold, just use standing value
    {
      dieAmount = dieAmount + "d10";
      moneyEarned = new Roll(dieAmount).roll().total;
    }
    else
      moneyEarned = dieAmount;

    // After rolling, determined how much, if any, was actually earned
    if (result.description.includes("Success"))
    {
      result.incomeResult = "You earn " + moneyEarned;
      switch (testData.income.tier)
      {
        case "b":
          result.incomeResult += " brass pennies."
          break;
        case "s":
          result.incomeResult += " silver shillings."
          break;
        case "g":
            if (moneyEarned > 1)
              result.incomeResult += " gold crowns."
            else
              result.incomeResult += " gold crown"
            break;
      }
    }
    else if (Number(result.SL) > -6)
    {
      result.incomeResult =  "You earn " + moneyEarned/2;
      switch (testData.income.tier)
      {
        case "b":
          result.incomeResult += " brass pennies."
          break;
        case "s":
          result.incomeResult += " silver shillings."
          break;
        case "g":
            if (moneyEarned/2 > 1)
              result.incomeResult += " gold crowns."
            else
              result.incomeResult += " gold crown"
            break;
      }
    }
    else
    {
      result.incomeResult =  "You have a very bad week, and earn nothing (or have your money stolen, or some similar mishap)."
    }
    await DiceWFRP.renderRollCard(cardOptions, result, rerenderMessage).then(msg => {
      ActorWfrp4e.handleOpposed(msg)
    })
  }

  /**
   * weaponOverride is used for weapon tests, see setupWeapon for how it's assigned.
   *
   * weaponOverride doesn't add any special functionality, it's main purpose being to call
   * DiceWFRP.rollWeaponTest() instead of the generic DiceWFRP.rollTest()
   *
   * @param {Object} testData         All the data needed to evaluate test results - see setupWeapon()
   * @param {Object} cardOptions      Data for the card display, title, template, etc.
   * @param {Object} rerenderMessage  The message to be updated (used if editing the chat card)
   */
  static async weaponOverride(testData, cardOptions, rerenderMessage = null)
  {
    if (game.user.targets.size)
        cardOptions.title += " - Opposed"

    let result = DiceWFRP.rollWeaponTest(testData);
    result.postFunction = "weaponOverride";

    await DiceWFRP.renderRollCard(cardOptions, result, rerenderMessage).then(msg => {
      ActorWfrp4e.handleOpposed(msg) // Send to handleOpposed to determine opposed status, if any.
    })
  }

  /**
   * castOverride is used for casting tests, see setupCast for how it's assigned.
   *
   * The only special functionality castOverride adds is reseting spell SL channelled back to 0, other than that,
   * it's main purpose is to call DiceWFRP.rollCastTest() instead of the generic DiceWFRP.rollTest().
   *
   * @param {Object} testData         All the data needed to evaluate test results - see setupCast()
   * @param {Object} cardOptions      Data for the card display, title, template, etc.
   * @param {Object} rerenderMessage  The message to be updated (used if editing the chat card)
   */
  static async castOverride(testData, cardOptions, rerenderMessage = null)
  {
    if (game.user.targets.size)
        cardOptions.title += " - Opposed"

    let result = DiceWFRP.rollCastTest(testData);
    result.postFunction = "castOverride";

    // Update spell to reflect SL from channelling resetting to 0
    WFRP_Utility.getSpeaker(cardOptions.speaker).updateOwnedItem({id: testData.extra.spell.id, 'data.cn.SL' : 0});

    await DiceWFRP.renderRollCard(cardOptions, result, rerenderMessage).then(msg => {
      ActorWfrp4e.handleOpposed(msg) // Send to handleOpposed to determine opposed status, if any.
    })
  }

  /**
   * channellOverride is used for casting tests, see setupCast for how it's assigned.
   *
   * channellOveride doesn't add any special functionality, it's main purpose being to call
   * DiceWFRP.rollChannellTest() instead of the generic DiceWFRP.rollTest()
   *
   * @param {Object} testData         All the data needed to evaluate test results - see setupChannell()
   * @param {Object} cardOptions      Data for the card display, title, template, etc.
   * @param {Object} rerenderMessage  The message to be updated (used if editing the chat card)
   */
  static async channellOverride(testData, cardOptions, rerenderMessage = null)
  {
    if (game.user.targets.size)
        cardOptions.title += " - Opposed"

    let result = DiceWFRP.rollChannellTest(testData, WFRP_Utility.getSpeaker(cardOptions.speaker));
    result.postFunction = "channellOverride";

    await DiceWFRP.renderRollCard(cardOptions, result, rerenderMessage).then(msg => {
      ActorWfrp4e.handleOpposed(msg) // Send to handleOpposed to determine opposed status, if any.
    })
  }

  /**
   * prayerOverride is used for casting tests, see setupCast for how it's assigned.
   *
   * prayerOverride doesn't add any special functionality, it's main purpose being to call
   * DiceWFRP.rollPrayerTest() instead of the generic DiceWFRP.rollTest()
   *
   * @param {Object} testData         All the data needed to evaluate test results - see setupPrayer()
   * @param {Object} cardOptions      Data for the card display, title, template, etc.
   * @param {Object} rerenderMessage  The message to be updated (used if editing the chat card)
   */
  static async prayerOverride(testData, cardOptions, rerenderMessage = null)
  {
    if (game.user.targets.size)
        cardOptions.title += " - Opposed"

    let result = DiceWFRP.rollPrayTest(testData, WFRP_Utility.getSpeaker(cardOptions.speaker));
    result.postFunction = "prayerOverride";

    await DiceWFRP.renderRollCard(cardOptions, result, rerenderMessage).then(msg => {
      ActorWfrp4e.handleOpposed(msg) // Send to handleOpposed to determine opposed status, if any.
    })
  }

  /**
   * traitOverride is used for Trait tests, see setupTrait for how it's assigned.
   *
   * Since traitOverride calls the generic DiceWFRP.rollTest(), which does not consider damage,
   * some post processing must be done to calculate damage values.
   *
   * @param {Object} testData         All the data needed to evaluate test results - see setupTrait()
   * @param {Object} cardOptions      Data for the card display, title, template, etc.
   * @param {Object} rerenderMessage  The message to be updated (used if editing the chat card)
   */
  static async traitOverride(testData, cardOptions, rerenderMessage = null)
  {
    if (game.user.targets.size)
        cardOptions.title += " - Opposed"

    let result = DiceWFRP.rollTest(testData);
    result.postFunction = "traitOverride";
    try
    {
      // If the specification of a trait is a number, it's probably damage. (Animosity (Elves) - not a number specification: no damage)
      if (!isNaN(testData.extra.trait.data.specification.value)) //         (Bite 7 - is a number specification, do damage)
      {
        testData.extra.damage = Number(result.SL) // Start damage off with SL

        if (Number(testData.extra.trait.data.specification.value)) // Add the specification starting value
          testData.extra.damage +=  Number(testData.extra.trait.data.specification.value)

        if (testData.extra.trait.data.rollable.bonusCharacteristic) // Add the bonus characteristic (probably strength)
          testData.extra.damage += Number(WFRP_Utility.getSpeaker(cardOptions.speaker).data.data.characteristics[testData.extra.trait.data.rollable.bonusCharacteristic].bonus) || 0;
      }
    }
    catch (error)
    {
      ui.notifications.error("Error calculating damage: " + error)
    } // If something went wrong calculating damage, do nothing and still render the card

    if (testData.extra)
      mergeObject(result, testData.extra);

      await DiceWFRP.renderRollCard(cardOptions, result, rerenderMessage).then(msg => {
        ActorWfrp4e.handleOpposed(msg) // Send to handleOpposed to determine opposed status, if any.
      })
  }

  /**
   * Determines opposed status, sets flags accordingly, creates start/result messages.
   *
   * There's 3 paths handleOpposed can take, either 1. Responding to being targeted, 2. Starting an opposed test, or neither.
   *
   * 1. Responding to a target: If the actor has a value in flags.oppose, that means another actor targeted them: Organize
   *    attacker and defender data, and send it to the OpposedWFRP.evaluateOpposedTest() method. Afterward, remove the oppose
   *    flag
   * 2. Starting an opposed test: If the user using the actor has a target, start an opposed Test: create the message then
   *    insert oppose data into the target's flags.oppose object.
   * 3. Neither: If no data in the actor's oppose flags, and no targets, skip everything and return.
   *
   *
   * @param {Object} message    The message created by the override (see above) - this message is the Test result message.
   */
  static async handleOpposed(message)
  {
    // Get actor/tokens and test results
    let actor = WFRP_Utility.getSpeaker(message.data.speaker)
    let testResult = message.data.flags.data.postData

    try 
    {
      /* -------------- IF OPPOSING AFTER BEING TARGETED -------------- */
      if (actor.data.flags.oppose) // If someone targets an actor, they insert data in the target's flags.oppose
      {                            // So if data exists here, this actor has been targeted, see below for what kind of data is stored here
        let attackMessage = game.messages.get(actor.data.flags.oppose.messageId) // Retrieve attacker's test result message
        // Organize attacker/defender data
        let attacker = {
          speaker : actor.data.flags.oppose.speaker,
          testResult : attackMessage.data.flags.data.postData,
          img : WFRP_Utility.getSpeaker(actor.data.flags.oppose.speaker).data.img
        }
        let defender = {
          speaker : message.data.speaker,
          testResult : testResult,
          img : actor.data.msg
        }                             // evaluateOpposedTest is usually for manual opposed tests, it requires extra options for targeted opposed test
        await OpposedWFRP.evaluateOpposedTest(attacker, defender, {target : true, startMessageId : actor.data.flags.oppose.startMessageId})
        await actor.update({"-=flags.oppose" : null}) // After opposing, remove oppose

      }

      /* -------------- IF TARGETING SOMEONE -------------- */
      else if (game.user.targets.size) // if user using the actor has targets
      {
        let attacker;
        // If token data was found in the message speaker (see setupChatOptions)
        if (message.data.speaker.token)
          attacker = canvas.tokens.get(message.data.speaker.token).data

        else // If no token data was found in the speaker, use the actor's token data instead
          attacker = actor.data.token

        // For each target, create a message, and insert oppose data in the targets' flags
        game.user.targets.forEach(async target => {
          let content =
          `<div class ="opposed-message"><b>${attacker.name}</b> is targeting <b>${target.data.name}</b></div>
          <div class = "opposed-tokens">
          <div class = "attacker"><img src="${attacker.img}" width="50" height="50"/></div>
          <div class = "defender"><img src="${target.data.img}" width="50" height="50"/></div>
          </div>`

          // Create the Opposed starting message
          //let startMessage = await ChatMessage.create({user : game.user._id, content : content, speaker : message.data.speaker, timestamp : message.data.timestamp - 1})
          let startMessage = await ChatMessage.create({user : game.user._id, content : content, speaker : message.data.speaker})
          // Add oppose data flag to the target
          target.actor.update({"flags.oppose" : {speaker : message.data.speaker, messageId : message.data._id, startMessageId : startMessage.data._id}})
          // Remove current targets
          target.setTarget(false);
        })
      }
    }
    catch
    {
      await actor.update({"-=flags.oppose" : null}) // If something went wrong, remove incoming opposed tests
    }
  }


  prepareSkill(basicSkills, advOrGrpSkills, skill) 
  {
    let actorData = this.data
    skill.data.characteristic.num = actorData.data.characteristics[skill.data.characteristic.value].value;
    skill.data.total.value = actorData.data.characteristics[skill.data.characteristic.value].value + skill.data.advances.value;
    skill.data.characteristic.abrev = WFRP4E.characteristicsAbbrev[skill.data.characteristic.value];

    if (skill.data.grouped.value == "isSpec" || skill.data.advanced.value == "adv")
      advOrGrpSkills.push(skill)
    else
      basicSkills.push(skill);
   }

  /* -------------------------------------------- */

   prepareTalent(talent, talentList) {
    let actorData = this.data
    let existingTalent = talentList.find(t => t.name == talent.name)
    if (existingTalent){
      if (!existingTalent.numMax){
        talent["numMax"]= actorData.data.characteristics[talent.data.max.value].bonus;
      }
        existingTalent.data.advances.value++;
    }
    else{
      switch(talent.data.max.value){
        case '1':
        talent["numMax"] = 1;
        break;

        case '2':
        talent["numMax"] = 2;
        break;

        case 'none':
        talent["numMax"] = "-";
        break;

        default:
        talent["numMax"]= actorData.data.characteristics[talent.data.max.value].bonus;
      }
      talentList.push(talent);
    }
   }

  prepareWeaponCombat(weapon, skills)
  {
    let actorData = this.data

    if (!skills)
    {
      skills = actorData.items.filter(i => i.type == "skill");
    }

    weapon.data.reach.value = WFRP4E.weaponReaches[weapon.data.reach.value];
    weapon.data.weaponGroup.value = WFRP4E.weaponGroups[weapon.data.weaponGroup.value];

    weapon.skillToUse = skills.find(x => x.name.toLowerCase().includes(weapon.data.weaponGroup.value.toLowerCase())) 
    weapon["properties"] = WFRP_Utility._prepareQualitiesFlaws(weapon, !!weapon.skillToUse);

    if (weapon.data.weaponGroup.value == "Flail" && !weapon.skillToUse && !weapon.properties.includes("Dangerous"))
      weapon.properties.push("Dangerous");

    weapon.data.range.value = this.calculateRangeOrDamage(weapon.data.range.value);
    if (weapon.data.damage.meleeValue)
    {
      weapon.data.damage.meleeValue = this.calculateRangeOrDamage(weapon.data.damage.meleeValue) + (actorData.flags.meleeDamageIncrease || 0);
      if (weapon.data.weaponDamage)
        weapon.data.damage.meleeValue -= weapon.data.weaponDamage
      else 
        weapon.data["weaponDamage"] = 0;
    }
    if (weapon.data.damage.rangedValue)
    {
      weapon.data.damage.rangedValue = this.calculateRangeOrDamage(weapon.data.damage.rangedValue) + (actorData.flags.rangedDamageIncrease || 0)
      if (weapon.data.weaponDamage)
        weapon.data.damage.rangedValue -= weapon.data.weaponDamage
      else 
        weapon.data["weaponDamage"] = 0;
    }

    if (Number(weapon.data.range.value) > 0)
      weapon["rangedWeaponType"] = true;
    if (weapon.data.reach.value)
      weapon["meleeWeaponType"] = true;

    // assign available ammo (TODO: Improve by keeping a constant list of ammo so a loop each time is necessary)
    if (weapon.data.ammunitionGroup.value != "none") {
      weapon["ammo"] = [];
      for ( let a of actorData.items ) {
        if (a.type == "ammunition" && a.data.ammunitionType.value == weapon.data.ammunitionGroup.value) // If is ammo and the correct type of ammo
            weapon.ammo.push(a);
      }
      this.prepareWeaponWithAmmo(weapon);
    }
    else if (weapon.data.weaponGroup.value == "Throwing" || weapon.data.weaponGroup.value == "Explosives")
    {
      weapon["ammo"] = [weapon];
      weapon.data.ammunitionGroup.value = "";
    }
    else if (weapon.data.weaponGroup.value == "Entangling")
    {
      weapon.data.ammunitionGroup.value = "";
    }
    weapon.properties = WFRP_Utility._separateQualitiesFlaws(weapon.properties);
    if (weapon.properties.special)
      weapon.properties.special = weapon.data.special.value;
    return weapon;
  }

  // Prepare a weapon to be displayed in the combat tab (calculate APs, organize qualities/flaws)
  prepareArmorCombat(armor, AP)
  { // -1 means currentAP is maxAP
    armor.properties = WFRP_Utility._separateQualitiesFlaws(WFRP_Utility._prepareQualitiesFlaws(armor));
    for (let apLoc in armor.data.currentAP)
    {
      if (armor.data.currentAP[apLoc] == -1)
      {
        armor.data.currentAP[apLoc] = armor.data.maxAP[apLoc];
      }
    }
    if (armor.data.maxAP.head > 0)
    {
      armor["protectsHead"] = true;
      AP.head.value += armor.data.currentAP.head;
      WFRP_Utility.addLayer(AP, armor, "head")
    }
    if (armor.data.maxAP.body > 0)
    {
      armor["protectsBody"] = true;
      AP.body.value += armor.data.currentAP.body;
      WFRP_Utility.addLayer(AP, armor, "body")
    }
    if (armor.data.maxAP.lArm > 0)
    {
      armor["protectslArm"] = true;
      AP.lArm.value += armor.data.currentAP.lArm;
      WFRP_Utility.addLayer(AP, armor, "lArm")
    }
    if (armor.data.maxAP.rArm > 0)
    {
      armor["protectsrArm"] = true;
      AP.rArm.value += armor.data.currentAP.rArm;
      WFRP_Utility.addLayer(AP, armor, "rArm")
    }
    if (armor.data.maxAP.lLeg > 0)
    {
      armor["protectslLeg"] = true;
      AP.lLeg.value += armor.data.currentAP.lLeg;
      WFRP_Utility.addLayer(AP, armor, "lLeg")
    }
    if (armor.data.maxAP.rLeg > 0)
    {
      armor["protectsrLeg"] = true
      AP.rLeg.value += armor.data.currentAP.rLeg;
      WFRP_Utility.addLayer(AP, armor, "rLeg")
    }
    return armor;
  }

 

  prepareWeaponWithAmmo(weapon)
  {
    let ammo = weapon.ammo.find(a => a.id == weapon.data.currentAmmo.value);
    if (!ammo)
      return;

    let ammoProperties = WFRP_Utility._prepareQualitiesFlaws(ammo);           // Skip undefined
    let specialPropInd =  ammoProperties.indexOf(ammoProperties.find(p => p && p.toLowerCase() == "special"));
    if (specialPropInd != -1)
      ammoProperties[specialPropInd] = ammoProperties[specialPropInd] + " Ammo"

    let ammoRange = ammo.data.range.value || "0";
    let ammoDamage = ammo.data.damage.value || "0";

    if (ammoRange.toLowerCase() == "as weapon")
    {
      // Do nothing to weapon's range
    }
    else if (ammoRange.toLowerCase() == "half weapon")
    {
      weapon.data.range.value /= 2;
    }
    else if (ammoRange.toLowerCase() == "third weapon")
    {
      weapon.data.range.value /= 3;
    }
    else if (ammoRange.toLowerCase() == "quarter weapon")
    {
      weapon.data.range.value /= 4;
    }
    else if (ammoRange.toLowerCase() == "twice weapon")
    {
      weapon.data.range.value *= 2;
    }
    else
    {
      try {
        ammoRange = eval(ammoRange);
        weapon.data.range.value = Math.floor(eval(weapon.data.range.value + ammoRange));
      }
      catch 
      {
        weapon.data.range.value = Math.floor(eval(weapon.data.range.value + ammoRange)); // Eval throws exception for "/2" for example. 
      }
    }
    
    try {
      ammoDamage = eval(ammoDamage);
      weapon.data.damage.rangedValue = Math.floor(eval(weapon.data.damage.rangedValue + ammoDamage));
    }
    catch { 
      weapon.data.damage.rangedValue = Math.floor(eval(weapon.data.damage.rangedValue + ammoDamage)); // Eval throws exception for "/2" for example. 
    }
    
    // The following code finds qualities or flaws of the ammo that add to the weapon's qualities
    // Example: Blast +1 should turn a weapon's Blast 4 into Blast 5
    ammoProperties = ammoProperties.filter(p => p != undefined);
    let propertyChange = ammoProperties.filter(p => p.includes("+") || p.includes("-")); // Properties that increase or decrease another (Blast +1, Blast -1)

    // Normal properties (Impale, Penetrating)
    let propertiesToAdd = ammoProperties.filter(p => !(p.includes("+") || p.includes("-")));

    for (let inc of propertyChange)
    {
      let index = inc.indexOf(" ");
      let property = inc.substring(0, index).trim();
      let value = inc.substring(index, inc.length);

      if (weapon.properties.find(p => p.includes(property)))
      {
        let basePropertyIndex = weapon.properties.findIndex(p => p.includes(property))
        let baseValue = weapon.properties[basePropertyIndex].split(" ")[1];
        let newValue = eval(baseValue + value)

        weapon.properties[basePropertyIndex] = `${property} ${newValue}`;
      }
      else
      {
        propertiesToAdd.push(property + " " + Number(value));
      }
    }

    weapon.properties = weapon.properties.concat(propertiesToAdd);
  }

  prepareSpellOrPrayer(item) {
    let actorData = this.data
    item['target'] = this.calculateSpellRangeOrDuration(item.data.target.value, item.data.target.aoe);
    item['duration'] = this.calculateSpellRangeOrDuration(item.data.duration.value);
    if (item.data.duration.extendable)
    {
      item.duration += "+";
    }
    item['range'] = this.calculateSpellRangeOrDuration(item.data.range.value);
    if (item.type == "spell")
      item['damage'] = this.calculateSpellDamage(item.data.damage.value, item.data.magicMissile.value);
    else
      item['damage'] = this.calculateSpellDamage(item.data.damage.value, false);

    if (item.type == "spell")
    {
      item.data.description.value = WFRP_Utility._spellDescription(item);
      if (!item.data.memorized.value )
        item.data.cn.value *= 2;
    }

    return item;
  }


  calculateSpellRangeOrDuration(formula, aoe=false)
  {
    let actorData = this.data
    formula = formula.toLowerCase();

    if (formula != "you" && formula != "special" && formula != "instant")
    {
      for(let ch in actorData.data.characteristics)
      {
        if (formula.includes(WFRP4E.characteristics[ch].toLowerCase()))
        {
          if (formula.includes('bonus'))
          {
            formula = formula.replace(WFRP4E.characteristics[ch].toLowerCase().concat(" bonus"),  actorData.data.characteristics[ch].bonus);
          }
          else
          {
            formula = formula.replace(WFRP4E.characteristics[ch].toLowerCase(),  actorData.data.characteristics[ch].value);
          }
        }
      }
    }

    if (aoe)
      formula = "AoE (" + formula.capitalize() + ")";
    return formula.capitalize();
  }

  calculateSpellDamage(formula, isMagicMissile)
  {
    let actorData = this.data
    formula = formula.toLowerCase();

    if (isMagicMissile)
    {
      formula += "+ willpower bonus"
    }

    for(let ch in actorData.data.characteristics)
    {

      while (formula.includes(actorData.data.characteristics[ch].label.toLowerCase()))
      {
        if (formula.includes('bonus'))
        {
          formula = formula.replace(WFRP4E.characteristics[ch].toLowerCase().concat(" bonus"),  actorData.data.characteristics[ch].bonus);
        }
        else
        {
          formula = formula.replace(WFRP4E.characteristics[ch].toLowerCase(),  actorData.data.characteristics[ch].value);
        }
      }
    }

    return eval(formula);
  }

  calculateArmorPenalties(armorList)
  {
    // Parsing armor penalties for the combat tab
    let armorPenaltiesString = "";
    let wearingMail = false;
    let wearingPlate = false;
    for (let a of armorList)
    {
      armorPenaltiesString += a.data.penalty.value + " ";
      if (a.data.armorType.value == "mail")
        wearingMail = true;
      if (a.data.armorType.value == "plate")
        wearingPlate = true;
    }

    if (wearingMail || wearingPlate)
    {
      let stealthPenaltyValue = 0;
      if (wearingMail)
        stealthPenaltyValue += -10;
      if (wearingPlate)
        stealthPenaltyValue += -10;

      armorPenaltiesString += (stealthPenaltyValue + " Stealth");
    }
    return armorPenaltiesString;
  }

  calculateRangeOrDamage(formula)
  {
    let actorData = this.data
    try {formula = formula.toLowerCase();}
    catch {return formula}

    for(let ch in actorData.data.characteristics)
    {
      if (formula.includes(ch.concat('b')))
      {
        formula = formula.replace(ch.concat('b'), actorData.data.characteristics[ch].bonus.toString());
      }
    }
    formula = formula.replace('x', '*');

    return eval(formula);
  }
}

// Assign the actor class to the CONFIG
CONFIG.Actor.entityClass = ActorWfrp4e;

// Treat the custom default token as a true default token
// If you change the actor image from the default token, it will automatically set the same image to be the token image
Hooks.on("preUpdateActor", (data, updatedData) =>{
  if (data.data.token.img == "systems/wfrp4e/tokens/unknown.png" && updatedData.img)
  {
    updatedData["token.img"] = updatedData.img;
  }
})
