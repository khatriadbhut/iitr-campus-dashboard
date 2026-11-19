const express = require('express');
const router = express.Router();
const { Club } = require('../database/schemas');
const { userLoggedIn } = require('../middlewares/userAuth');
const { checkManageClub } = require('../middlewares/permissions/manageClubs');
const cache = require('../utils/cache');
const { Joi, validateBody, validateParams, id } = require('../middlewares/validate');
const clubFields = {
    name: Joi.string().trim().max(200),
    email: Joi.string().trim().email().max(200).allow(null, ''),
    description: Joi.string().trim().max(4000).allow(null, ''),
    logo_url: Joi.string().trim().uri().max(1000).allow(null, ''),
};
const createClubBody = Joi.object({ ...clubFields, name: clubFields.name.required() });
const updateClubBody = Joi.object(clubFields);
const clubIdParam = Joi.object({ id: id.required() });


// Route to get all clubs
router.get('/', userLoggedIn, async (req, res) => {
    try {
        const cachedClubs = cache.get('all_clubs');
        if (cachedClubs) {
            return res.json({ clubs: cachedClubs });
        }

        const clubs = await Club.findAll()
        
        cache.set('all_clubs', clubs, 3600); // Cache for 1 hour

        return res.json({ clubs });
    } catch (error) {
        console.error('Error fetching clubs:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch clubs'
        });
    }
});

// Route to get a club using id
router.get('/:id', userLoggedIn, async (req, res) => {
    try {
        const { id } = req.params
        const club = await Club.findOne({
            where: {
                id: id
            }
        })

        return res.json({ club });
    } catch (error) {
        console.error('Error fetching clubs:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch clubs'
        });
    }
});

// Protected route to create club
router.post('/create', checkManageClub, validateBody(createClubBody), async (req, res) => {
    const { name, email, description, logo_url } = req.body;

    try {
        const clubs = await Club.create({
            name: name,
            email: email || null,
            description: description,
            logo_url: logo_url
        })
        cache.del('all_clubs'); // Invalidate cache
        res.json({ clubs });
    } catch (error) {
        console.error('Error creating club:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not create club'
        });
    }
});

// Protected route to delete club
router.delete('/delete/:id', checkManageClub, async (req, res) => {
    const { id } = req.params

    try {
        const clubs = await Club.destroy({
            where: {
                id: id
            }
        })
        cache.del('all_clubs'); // Invalidate cache
        res.json({ clubs });
    } catch (error) {
        console.error('Error deleting club:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not delete club'
        });
    }
});

// Protected route to update club
router.patch('/update/:id', checkManageClub, validateParams(clubIdParam), validateBody(updateClubBody), async (req, res) => {
    const { id } = req.params
    const { name, email, description, logo_url } = req.body
    try {
        const clubs = await Club.update({
            name: name,
            email: email || null,
            description: description,
            logo_url: logo_url
        }, {
            where: {
                id: id
            }
        })
        cache.del('all_clubs'); // Invalidate cache
        res.json({ clubs });
    } catch (error) {
        console.error('Error updating club:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not update club'
        });
    }
});

module.exports = router;